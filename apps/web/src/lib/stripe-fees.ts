/**
 * Stripe から決済手数料を取得する。
 *
 * ## なぜ Stripe に問い合わせる必要があるのか
 *
 * 手数料は DB に保存していない (Payment テーブルに列が無い)。
 * 決済時に記録する方式にすると、記録を始める前の過去の決済は
 * 永久に手数料が空欄になる。経理では «先月分» や «昨年度» を
 * 遡って出力することが多いため、レポート生成時に
 * その都度 Stripe から取得する方式を採っている。
 *
 * ## 手数料はどこにあるか
 *
 * Stripe では手数料は Charge ではなく **BalanceTransaction** が持つ。
 *
 *   PaymentIntent → latest_charge → balance_transaction → fee
 *
 * Payment テーブルには stripeChargeId / stripePaymentIntentId を
 * 保存しているので、Charge を expand して balance_transaction を辿る。
 *
 * ## 取得できないケースを «0 円» にしない（重要）
 *
 * 次の場合は手数料が取得できない:
 *   - 古い決済で stripeChargeId が保存されていない
 *   - テストモードと本番モードでキーが違う (相手側に存在しない)
 *   - Stripe API の一時的な失敗
 *   - まだ balance_transaction が確定していない (処理中)
 *
 * このとき 0 円として黙って集計すると、
 * **手数料が実際より少なく見え、利益を過大に表示する** ことになる。
 * 経理資料としては最悪の壊れ方なので、null を返して
 * 「取得できなかった件数」としてレポートに明示する。
 *
 * ## 件数が多いときの配慮
 *
 * 1 件ずつ API を叩くため、件数に比例して時間がかかる。
 * 同時実行数を絞りつつ並列化し、上限を超える場合は打ち切って
 * 呼び出し側に伝える (レポートに注記を出すため)。
 */
import type Stripe from 'stripe';
import { getStripe } from './stripe';

/** 手数料取得の対象 */
export type FeeLookupTarget = {
  id: string;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
};

export type FeeLookupResult = {
  /** Payment.id → 手数料 (円)。取得できなかったものは含めない */
  fees: Map<string, number>;
  /** Stripe に問い合わせた件数 */
  requested: number;
  /** 取得に失敗・未確定だった件数 */
  failed: number;
};

/**
 * 同時に投げるリクエスト数。
 * 大きくすると速いが Stripe のレート制限に当たりやすい。
 * 経理レポートは «たまに実行する重い処理» なので控えめにする。
 */
const CONCURRENCY = 5;

/**
 * 1 回のレポートで問い合わせる上限。
 * これを超える場合は打ち切る (応答時間とレート制限の保護)。
 */
export const FEE_LOOKUP_LIMIT = 600;

/**
 * BalanceTransaction から手数料を取り出す。
 *
 * fee は «その決済にかかった手数料の合計» (円)。
 * JPY は最小単位が円なので、そのまま円として扱える
 * (USD 等ならセント → ドルの換算が必要になる点に注意)。
 */
function extractFee(charge: Stripe.Charge): number | null {
  const bt = charge.balance_transaction;
  if (!bt) return null;
  if (typeof bt === 'string') return null; // expand されていない
  if (typeof bt.fee !== 'number') return null;
  return bt.fee;
}

/**
 * 決済ごとの Stripe 手数料をまとめて取得する。
 *
 * 失敗した 1 件でレポート全体を落とさない
 * (経理作業が「エラーで何も出ない」より
 *  「一部の手数料が空欄」のほうが実用的)。
 */
export async function fetchStripeFees(
  targets: FeeLookupTarget[],
): Promise<FeeLookupResult> {
  const fees = new Map<string, number>();

  // Charge ID か PaymentIntent ID のどちらかが無いと辿れない。
  const lookupable = targets.filter(
    (t) => t.stripeChargeId || t.stripePaymentIntentId,
  );
  const capped = lookupable.slice(0, FEE_LOOKUP_LIMIT);

  if (capped.length === 0) {
    return { fees, requested: 0, failed: targets.length };
  }

  /**
   * Stripe クライアントの生成自体が失敗することがある
   * (STRIPE_SECRET_KEY 未設定、テスト環境、Stripe の設定変更中など)。
   *
   * ここで例外を投げるとレポートが 1 枚も出せなくなる。
   * 手数料は «あると嬉しい情報» であって、売上・消費税の集計は
   * Stripe に依存していない。決済ごとの失敗と同じ扱いにして、
   * 手数料だけ «取得不可» としたレポートを出せるようにする。
   */
  let stripe: Awaited<ReturnType<typeof getStripe>>;
  try {
    stripe = await getStripe();
  } catch {
    return { fees, requested: 0, failed: targets.length };
  }

  let failed = targets.length - capped.length;

  // 同時実行数を絞った並列処理。
  // Promise.all で一気に投げるとレート制限に当たるため、
  // ワーカーを CONCURRENCY 個だけ走らせてキューを消化する。
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= capped.length) return;
      const t = capped[index]!;
      try {
        let charge: Stripe.Charge | null = null;

        if (t.stripeChargeId) {
          charge = (await stripe.charges.retrieve(t.stripeChargeId, {
            expand: ['balance_transaction'],
          })) as Stripe.Charge;
        } else if (t.stripePaymentIntentId) {
          // Charge ID が無い場合は PaymentIntent から辿る。
          const pi = (await stripe.paymentIntents.retrieve(t.stripePaymentIntentId, {
            expand: ['latest_charge.balance_transaction'],
          })) as Stripe.PaymentIntent;
          const latest = pi.latest_charge;
          if (latest && typeof latest !== 'string') charge = latest;
        }

        const fee = charge ? extractFee(charge) : null;
        if (fee === null) {
          failed += 1;
        } else {
          fees.set(t.id, fee);
        }
      } catch {
        // 個別の失敗はレポート全体を落とさない。
        // (テストモード/本番モードの取り違えや、削除済みの決済など)
        failed += 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, capped.length) }, () => worker()),
  );

  return { fees, requested: capped.length, failed };
}
