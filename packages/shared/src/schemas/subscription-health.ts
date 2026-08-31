/**
 * サブスクリプション整合性（プラン反映）の検知ロジック
 *
 * ## なぜこのファイルが必要か
 *
 * このサイトの「今どのプランか」は Stripe の入金記録ではなく、
 * DB の Subscription テーブルだけを見て決まる。
 *
 *   credentials.ts:
 *     plan = user.subscriptions[0] ? そのplanType : 'FREE'
 *
 * つまり Stripe 側で決済が成功していても、Webhook の取りこぼしや
 * ユーザー紐付け失敗で Subscription 行が作られなかった場合、
 * 会員は無条件で FREE 扱いになる。
 * 「支払ったのに無料プランのまま」という不具合はこれが原因で起きる。
 *
 * さらに悪いことに、これまでこの状態は
 *   - Webhook は Stripe に 200 を返す（＝再送されない）
 *   - 失敗理由は console.warn に出るだけ
 *   - 管理画面に「おかしい人」を見つける導線が無い
 * ため、**会員からの申告が来るまで誰も気づけなかった**。
 *
 * ここでは「決済記録はあるのに有効なサブスクが無い」等の不整合を
 * 純粋関数として判定できるようにし、管理画面から能動的に検知できるようにする。
 * DB / Stripe に触れない純粋関数にすることで、境界条件をテストで固定する。
 */

/** サブスクの状態のうち「有効（＝有料プランとして扱う）」もの */
export const ACTIVE_SUBSCRIPTION_STATUSES = [
  'ACTIVE',
  'TRIALING',
  'PAST_DUE',
] as const;

export type ActiveSubscriptionStatus = (typeof ACTIVE_SUBSCRIPTION_STATUSES)[number];

/**
 * 与えられた status が「有料プランとして扱われる」状態かどうか。
 *
 * ここは auth.ts / credentials.ts のクエリ条件
 *   status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] }
 * と必ず一致していなければならない。ズレると検知結果と実際の
 * プラン判定が食い違い、「検知では正常なのに会員は使えない」が起きる。
 */
export function isActiveSubscriptionStatus(status: string): boolean {
  return (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/** 不整合の種類 */
export type SubscriptionMismatchKind =
  /** 決済成功の記録はあるのに、有効なサブスクが1件も無い（＝会員はFREE扱い） */
  | 'PAID_BUT_NO_ACTIVE_SUB'
  /** サブスク行はあるが INCOMPLETE のまま取り残されている */
  | 'STUCK_INCOMPLETE'
  /** 有効なサブスクが複数ある（二重契約の疑い） */
  | 'DUPLICATE_ACTIVE_SUB';

/** 検知の深刻度。UI の並び順・色分けに使う */
export type SubscriptionMismatchSeverity = 'critical' | 'warning';

export type SubscriptionMismatchInput = {
  /** 決済成功(SUCCEEDED)のサブスク課金レコード件数 */
  succeededSubscriptionPaymentCount: number;
  /** 直近の決済成功日時（無ければ null） */
  lastSucceededPaymentAt: Date | null;
  /** このユーザーが持つサブスク行の status 一覧 */
  subscriptionStatuses: string[];
};

export type SubscriptionMismatch = {
  kind: SubscriptionMismatchKind;
  severity: SubscriptionMismatchSeverity;
  /** 管理者向けの説明文（日本語） */
  message: string;
};

/**
 * 1ユーザー分の状態から不整合を検出する。
 *
 * 「決済があるのに有効サブスクが無い」を最優先(critical)にしているのは、
 * これが会員にとって実害（お金を払ったのに使えない）が出ている唯一の状態だから。
 * INCOMPLETE 残留や二重契約は、放置すると実害になるが即時ではないので warning。
 */
export function detectSubscriptionMismatches(
  input: SubscriptionMismatchInput,
): SubscriptionMismatch[] {
  const result: SubscriptionMismatch[] = [];
  const activeCount = input.subscriptionStatuses.filter(isActiveSubscriptionStatus).length;

  // ① 実害あり: 支払っているのにプランが付いていない
  if (input.succeededSubscriptionPaymentCount > 0 && activeCount === 0) {
    result.push({
      kind: 'PAID_BUT_NO_ACTIVE_SUB',
      severity: 'critical',
      message:
        '決済は成功していますが、有効なサブスクリプションがありません。この会員は無料プラン扱いになっています。',
    });
  }

  // ② 取り残し: INCOMPLETE のまま（決済が後追い確定したケース等）
  //    ①が出ている場合は原因の説明として併記したいので、独立して判定する。
  if (activeCount === 0 && input.subscriptionStatuses.includes('INCOMPLETE')) {
    result.push({
      kind: 'STUCK_INCOMPLETE',
      severity: 'warning',
      message:
        'サブスクリプションが INCOMPLETE のまま残っています。決済が後から確定した可能性があります。',
    });
  }

  // ③ 二重契約: 有効なサブスクが複数
  if (activeCount > 1) {
    result.push({
      kind: 'DUPLICATE_ACTIVE_SUB',
      severity: 'warning',
      message: `有効なサブスクリプションが ${activeCount} 件あります。二重に課金されている可能性があります。`,
    });
  }

  return result;
}

/**
 * 検知結果全体の深刻度。critical が1つでもあれば critical。
 */
export function overallSeverity(
  mismatches: SubscriptionMismatch[],
): SubscriptionMismatchSeverity | null {
  if (mismatches.length === 0) return null;
  return mismatches.some((m) => m.severity === 'critical') ? 'critical' : 'warning';
}

/**
 * 「支払ってから何日プランが付いていないか」を返す。
 *
 * 運営が対応の緊急度を判断するために使う。
 * 決済日時が無い / 未来日付の場合は 0 を返す（負の日数を出さない）。
 */
export function daysSincePayment(paidAt: Date | null, now: Date = new Date()): number {
  if (!paidAt) return 0;
  const diffMs = now.getTime() - paidAt.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/** Webhook 処理の結果種別（DB に記録して後から追跡するために使う） */
export type WebhookOutcome = 'SUCCESS' | 'SKIPPED' | 'FAILED';

/**
 * ハンドラの戻り値から記録すべき outcome と理由を決める。
 *
 * これまで `{ ok: false, reason: 'user_not_found' }` は console.warn に
 * 出るだけで Stripe には 200 を返していたため、記録がどこにも残らなかった。
 * ここで SKIPPED として DB に残せるようにする。
 */
export function resolveWebhookOutcome(result: {
  ok: boolean;
  reason?: string;
}): { outcome: WebhookOutcome; reason: string | null } {
  if (result.ok) return { outcome: 'SUCCESS', reason: null };
  return { outcome: 'SKIPPED', reason: result.reason ?? 'unknown' };
}

/**
 * 運営が「対応が必要」と判断すべき Webhook の失敗理由かどうか。
 *
 * no_items や no_invoice_id は Stripe 側のデータ都合で、
 * 会員に実害が出ないことがほとんど。一方 user_not_found は
 * 「決済されたのに誰のものか分からず捨てられた」状態で、
 * 必ず会員が有料プランを使えなくなっているため区別する。
 */
export const ACTIONABLE_WEBHOOK_REASONS = ['user_not_found'] as const;

export function isActionableWebhookReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return (ACTIONABLE_WEBHOOK_REASONS as readonly string[]).includes(reason);
}
