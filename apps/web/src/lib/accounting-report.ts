/**
 * 経理用 月次売上レポートの計算ロジック (純粋関数)。
 *
 * DB や Stripe には触らない。集計の正しさをテストで固定するため、
 * 数字を作る部分だけをここに切り出している。
 *
 * ## 消費税の扱いが 2 通りあるので注意（最重要）
 *
 * このサイトの売上は税の持ち方が種別によって違う。ここを一律に扱うと
 * 経理の数字がずれるため、種別ごとに分けて計算する。
 *
 *   1. EC 注文 (ONE_TIME_ORDER)
 *      Order に subtotal / taxAmount / shippingFee を個別に保存している
 *      (lib/pricing.ts の calculateOrderTotals が
 *       taxAmount = floor(subtotal * 0.1) で算出)。
 *      → **保存された taxAmount をそのまま使う**。
 *        再計算すると端数処理の違いで実際の請求額と 1 円ずれることがある。
 *
 *   2. サブスク (SUBSCRIPTION) / チケット代 (TICKET_FEE)
 *      価格が **税込** で決まっている (PLAN_PRICES は税込 ¥666 / ¥7,920)。
 *      税額は保存されていない。
 *      → 税込金額から逆算する: 税額 = 税込 - round(税込 / 1.1)
 *
 * ## 逆算の丸め方について
 *
 * 税抜 = 税込 / 1.1 は割り切れないことが多い。
 * ここでは税抜を四捨五入し、税額 = 税込 - 税抜 とする。
 * こうすると **税抜 + 税額 = 税込** が必ず成り立ち、
 * レポート上で合計が 1 円合わない事故を防げる。
 * (税額側を丸めると、税抜との和が税込と一致しないことがある)
 *
 * ⚠️ 本レポートは «社内の管理資料» の位置づけ。
 *    適格請求書 (インボイス) としての要件は満たしていないため、
 *    PDF 側にもその旨を注記する。
 */

/** 消費税率。@idol/shared の TAX_RATE と同じ値を使う。 */
export const REPORT_TAX_RATE = 0.1;

/** 集計対象の決済 1 件 (レポートに必要な最小フィールド) */
export type ReportPayment = {
  id: string;
  /** 'SUBSCRIPTION' | 'ONE_TIME_ORDER' | 'TICKET_FEE' */
  kind: string;
  /** 請求額 (税込・円) */
  amount: number;
  createdAt: Date;
  /** Stripe 手数料 (円)。取得できなかった場合は null */
  feeAmount: number | null;
  /** EC 注文のときだけ入る、保存済みの内訳 */
  order?: {
    subtotal: number;
    taxAmount: number;
    shippingFee: number;
  } | null;
  /** 表示用 */
  userEmail?: string | null;
  orderNumber?: string | null;
};

/** 税の内訳 (円) */
export type TaxBreakdown = {
  /** 税込金額 */
  gross: number;
  /** 税抜金額 (本体価格) */
  net: number;
  /** 消費税額 */
  tax: number;
};

/**
 * 税込金額から税抜・税額を逆算する。
 *
 * 税抜を四捨五入し、税額は差分で求める (net + tax === gross を保証)。
 */
export function backOutTax(gross: number, rate: number = REPORT_TAX_RATE): TaxBreakdown {
  if (gross === 0) return { gross: 0, net: 0, tax: 0 };
  // 負の金額 (返金など) でも符号を保ったまま計算できるようにする。
  const net = Math.round(gross / (1 + rate));
  return { gross, net, tax: gross - net };
}

/**
 * 決済 1 件の税内訳を求める。
 *
 * EC 注文は保存された taxAmount を優先する (上のコメント参照)。
 * それ以外は税込金額からの逆算。
 */
export function taxBreakdownForPayment(p: ReportPayment): TaxBreakdown {
  if (p.kind === 'ONE_TIME_ORDER' && p.order) {
    /**
     * 送料も課税対象なので税額に含まれるべきだが、
     * calculateOrderTotals は subtotal のみに税を掛けている
     * (税額 = floor(subtotal * 0.1))。
     * ここで «正しい» 税額に直すと、実際に請求・入金された額と
     * 帳簿が合わなくなる。経理資料としては
     * **実際に請求した内訳をそのまま載せる** ほうが正しいので、
     * 保存値を尊重する。
     */
    const tax = p.order.taxAmount;
    return { gross: p.amount, net: p.amount - tax, tax };
  }
  return backOutTax(p.amount);
}

/** 種別ごとの小計 */
export type KindSummary = {
  kind: string;
  count: number;
  gross: number;
  net: number;
  tax: number;
  /** Stripe 手数料の合計 (取得できたぶんだけ) */
  fee: number;
  /** 手数料が取得できなかった件数 */
  feeMissing: number;
};

/** レポート全体 */
export type AccountingSummary = {
  /** 決済件数 (成功のみ) */
  count: number;
  /** 売上 (税込) */
  gross: number;
  /** 売上 (税抜) */
  net: number;
  /** 消費税額 */
  tax: number;
  /** Stripe 手数料合計 */
  fee: number;
  /** 手数料を取得できなかった件数 */
  feeMissing: number;
  /** 差引入金額 (税込売上 - 手数料) */
  netPayout: number;
  /** 種別ごとの内訳 (件数 0 の種別は含めない) */
  byKind: KindSummary[];
};

/** 種別の表示順。レポートの並びを安定させるために固定する。 */
const KIND_ORDER = ['SUBSCRIPTION', 'ONE_TIME_ORDER', 'TICKET_FEE'] as const;

/**
 * 決済一覧を集計する。
 *
 * 呼び出し側で «成功した決済のみ» に絞ってから渡すこと
 * (失敗・処理中を混ぜると売上が過大になる)。
 */
export function summarizePayments(payments: ReportPayment[]): AccountingSummary {
  const buckets = new Map<string, KindSummary>();

  let gross = 0;
  let net = 0;
  let tax = 0;
  let fee = 0;
  let feeMissing = 0;

  for (const p of payments) {
    const b = taxBreakdownForPayment(p);
    gross += b.gross;
    net += b.net;
    tax += b.tax;
    if (p.feeAmount === null) {
      feeMissing += 1;
    } else {
      fee += p.feeAmount;
    }

    const cur =
      buckets.get(p.kind) ??
      { kind: p.kind, count: 0, gross: 0, net: 0, tax: 0, fee: 0, feeMissing: 0 };
    cur.count += 1;
    cur.gross += b.gross;
    cur.net += b.net;
    cur.tax += b.tax;
    if (p.feeAmount === null) cur.feeMissing += 1;
    else cur.fee += p.feeAmount;
    buckets.set(p.kind, cur);
  }

  // 既知の種別を定義順に並べ、未知の種別は後ろに回す
  // (種別が増えたときにレポートから漏れないようにする)。
  const known = KIND_ORDER.filter((k) => buckets.has(k)).map((k) => buckets.get(k)!);
  const unknown = [...buckets.keys()]
    .filter((k) => !(KIND_ORDER as readonly string[]).includes(k))
    .sort()
    .map((k) => buckets.get(k)!);

  return {
    count: payments.length,
    gross,
    net,
    tax,
    fee,
    feeMissing,
    netPayout: gross - fee,
    byKind: [...known, ...unknown],
  };
}

/**
 * 手数料が «1 件も» 取得できなかったかを判定する。
 *
 * この場合に「手数料 ¥0 / 差引入金額 = 売上全額」と表示すると、
 * **手数料ゼロで満額入金された** と誤読される。
 * 実際は «金額が分からない» だけなので、PDF 側では数字を出さず
 * 「取得不可 / 算出不可」と表示する。
 *
 * 一部だけ取得できている場合は false (合計を出したうえで不足件数を注記する)。
 */
export function isFeeTotallyUnavailable(summary: AccountingSummary): boolean {
  return summary.count > 0 && summary.fee === 0 && summary.feeMissing > 0;
}

// ---------------------------------------------------------------------------
// 月次の期間計算 (JST)
// ---------------------------------------------------------------------------

/**
 * 「YYYY-MM」を JST の月初〜翌月初 (半開区間) に変換する。
 *
 * ## なぜ半開区間 [from, to) なのか
 *
 * 月末を «23:59:59» で表すと、23:59:59.500 のような決済が漏れる。
 * 「翌月 1 日 0 時未満」で比較すれば取りこぼしが起きない。
 *
 * ## なぜ JST を明示するのか
 *
 * サーバーの時刻は UTC で動く。UTC で月初を作ると
 * 日本時間の «1 日 0:00〜8:59» の決済が前月に入ってしまい、
 * 月次の数字が毎月ずれる。
 * JST は UTC+9 固定 (サマータイムなし) なので、
 * 9 時間を引いた UTC 時刻として組み立てられる。
 */
export function jstMonthRange(month: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  if (year < 2000 || year > 2999) return null;

  // JST の 00:00 は UTC の前日 15:00。Date.UTC で直接その時刻を作る。
  const from = new Date(Date.UTC(year, mon - 1, 1, -9, 0, 0, 0));
  const to = new Date(Date.UTC(year, mon, 1, -9, 0, 0, 0));
  return { from, to };
}

/** 「2026-09」→「2026年9月」 */
export function formatMonthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) return month;
  return `${Number(m[1])}年${Number(m[2])}月`;
}

/**
 * 指定日 (既定は今日) を含む月の「YYYY-MM」を JST で返す。
 * 画面の初期値に使う。
 */
export function currentJstMonth(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * 選択肢に出す月の一覧 (新しい順)。
 *
 * 未来の月は出さない。まだ発生していない期間を選べると
 * 「0 件のレポート」が出て運営が不具合と誤解するため。
 */
export function recentJstMonths(count: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  let y = jst.getUTCFullYear();
  let m = jst.getUTCMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}
