import {
  backOutTax,
  currentJstMonth,
  formatMonthLabel,
  jstMonthRange,
  recentJstMonths,
  summarizePayments,
  taxBreakdownForPayment,
  isFeeTotallyUnavailable,
  type ReportPayment,
} from './accounting-report';

const pay = (over: Partial<ReportPayment> = {}): ReportPayment => ({
  id: 'p1',
  kind: 'SUBSCRIPTION',
  amount: 666,
  createdAt: new Date('2026-09-15T00:00:00Z'),
  feeAmount: 30,
  ...over,
});

describe('backOutTax — 税込からの逆算', () => {
  it('税抜 + 税額 = 税込 が必ず成り立つ (合計が1円ずれない)', () => {
    // ここが崩れるとレポート上で「内訳の合計が総額と合わない」ことになる。
    for (const gross of [1, 10, 100, 666, 1000, 7920, 12345, 99999]) {
      const b = backOutTax(gross);
      expect(b.net + b.tax).toBe(gross);
    }
  });

  it('スタンダード月額 ¥666 (税込) を分解できる', () => {
    // 666 / 1.1 = 605.45... → 605、税額 61
    expect(backOutTax(666)).toEqual({ gross: 666, net: 605, tax: 61 });
  });

  it('プレミアム年額 ¥7,920 (税込) を分解できる', () => {
    // 7920 / 1.1 = 7200 ちょうど
    expect(backOutTax(7920)).toEqual({ gross: 7920, net: 7200, tax: 720 });
  });

  it('0 円は 0 のまま', () => {
    expect(backOutTax(0)).toEqual({ gross: 0, net: 0, tax: 0 });
  });

  it('返金などの負の金額でも符号を保つ', () => {
    const b = backOutTax(-7920);
    expect(b.gross).toBe(-7920);
    expect(b.net).toBe(-7200);
    expect(b.tax).toBe(-720);
    expect(b.net + b.tax).toBe(-7920);
  });

  it('税率を変えても計算できる (将来の税率改定に備える)', () => {
    const b = backOutTax(1080, 0.08);
    expect(b.net + b.tax).toBe(1080);
    expect(b.net).toBe(1000);
  });
});

describe('taxBreakdownForPayment — 種別による税の扱いの違い', () => {
  it('EC注文は保存された taxAmount をそのまま使う', () => {
    // 実際に請求した内訳と帳簿を一致させる必要がある。
    // 逆算すると端数処理の違いで実請求額とずれる。
    const p = pay({
      kind: 'ONE_TIME_ORDER',
      amount: 3800,
      order: { subtotal: 3000, taxAmount: 300, shippingFee: 500 },
    });
    expect(taxBreakdownForPayment(p)).toEqual({ gross: 3800, net: 3500, tax: 300 });
  });

  it('EC注文でも order が無ければ逆算にフォールバックする', () => {
    // 注文レコードが取れなかった場合に 0 円扱いにしない。
    const p = pay({ kind: 'ONE_TIME_ORDER', amount: 1100, order: null });
    expect(taxBreakdownForPayment(p)).toEqual({ gross: 1100, net: 1000, tax: 100 });
  });

  it('サブスクは税込価格からの逆算', () => {
    expect(taxBreakdownForPayment(pay({ kind: 'SUBSCRIPTION', amount: 666 }))).toEqual({
      gross: 666,
      net: 605,
      tax: 61,
    });
  });

  it('チケット代も逆算', () => {
    expect(taxBreakdownForPayment(pay({ kind: 'TICKET_FEE', amount: 2200 }))).toEqual({
      gross: 2200,
      net: 2000,
      tax: 200,
    });
  });
});

describe('summarizePayments', () => {
  it('空配列ならすべて 0', () => {
    const s = summarizePayments([]);
    expect(s).toMatchObject({ count: 0, gross: 0, net: 0, tax: 0, fee: 0, netPayout: 0 });
    expect(s.byKind).toEqual([]);
  });

  it('税抜 + 税額 = 税込 が合計でも成り立つ', () => {
    const s = summarizePayments([
      pay({ id: 'a', kind: 'SUBSCRIPTION', amount: 666 }),
      pay({ id: 'b', kind: 'SUBSCRIPTION', amount: 7920 }),
      pay({
        id: 'c',
        kind: 'ONE_TIME_ORDER',
        amount: 3800,
        order: { subtotal: 3000, taxAmount: 300, shippingFee: 500 },
      }),
    ]);
    expect(s.net + s.tax).toBe(s.gross);
    expect(s.gross).toBe(666 + 7920 + 3800);
  });

  it('差引入金額 = 税込売上 - 手数料', () => {
    const s = summarizePayments([
      pay({ id: 'a', amount: 1000, feeAmount: 40 }),
      pay({ id: 'b', amount: 2000, feeAmount: 76 }),
    ]);
    expect(s.gross).toBe(3000);
    expect(s.fee).toBe(116);
    expect(s.netPayout).toBe(2884);
  });

  it('手数料が取得できなかった件数を数え、合計には含めない', () => {
    // 手数料 null を 0 として黙って足すと、
    // 「手数料が安く見える」= 利益を過大に見せる方向に誤る。
    const s = summarizePayments([
      pay({ id: 'a', amount: 1000, feeAmount: 40 }),
      pay({ id: 'b', amount: 1000, feeAmount: null }),
    ]);
    expect(s.fee).toBe(40);
    expect(s.feeMissing).toBe(1);
  });

  it('種別ごとに小計を出す', () => {
    const s = summarizePayments([
      pay({ id: 'a', kind: 'SUBSCRIPTION', amount: 666, feeAmount: 30 }),
      pay({ id: 'b', kind: 'SUBSCRIPTION', amount: 666, feeAmount: 30 }),
      pay({ id: 'c', kind: 'TICKET_FEE', amount: 2200, feeAmount: 80 }),
    ]);
    const sub = s.byKind.find((k) => k.kind === 'SUBSCRIPTION')!;
    expect(sub.count).toBe(2);
    expect(sub.gross).toBe(1332);
    expect(sub.fee).toBe(60);
    const ticket = s.byKind.find((k) => k.kind === 'TICKET_FEE')!;
    expect(ticket.count).toBe(1);
  });

  it('種別の並び順が固定される (サブスク→EC→チケット)', () => {
    const s = summarizePayments([
      pay({ id: 'c', kind: 'TICKET_FEE', amount: 100 }),
      pay({ id: 'b', kind: 'ONE_TIME_ORDER', amount: 100, order: null }),
      pay({ id: 'a', kind: 'SUBSCRIPTION', amount: 100 }),
    ]);
    expect(s.byKind.map((k) => k.kind)).toEqual([
      'SUBSCRIPTION',
      'ONE_TIME_ORDER',
      'TICKET_FEE',
    ]);
  });

  it('未知の種別も欠落せず末尾に含まれる', () => {
    // 種別が増えたときにレポートから静かに消えるのを防ぐ。
    const s = summarizePayments([
      pay({ id: 'a', kind: 'SUBSCRIPTION', amount: 100 }),
      pay({ id: 'x', kind: 'FUTURE_KIND', amount: 500 }),
    ]);
    expect(s.byKind.map((k) => k.kind)).toEqual(['SUBSCRIPTION', 'FUTURE_KIND']);
    expect(s.gross).toBe(600);
  });

  it('種別小計の合計が全体の合計と一致する', () => {
    const s = summarizePayments([
      pay({ id: 'a', kind: 'SUBSCRIPTION', amount: 666, feeAmount: 30 }),
      pay({ id: 'b', kind: 'TICKET_FEE', amount: 2200, feeAmount: 80 }),
      pay({
        id: 'c',
        kind: 'ONE_TIME_ORDER',
        amount: 3800,
        order: { subtotal: 3000, taxAmount: 300, shippingFee: 500 },
        feeAmount: 130,
      }),
    ]);
    expect(s.byKind.reduce((n, k) => n + k.gross, 0)).toBe(s.gross);
    expect(s.byKind.reduce((n, k) => n + k.tax, 0)).toBe(s.tax);
    expect(s.byKind.reduce((n, k) => n + k.fee, 0)).toBe(s.fee);
    expect(s.byKind.reduce((n, k) => n + k.count, 0)).toBe(s.count);
  });
});

describe('jstMonthRange — JST の月境界', () => {
  it('JST の月初 0:00 から翌月初 0:00 まで (半開区間)', () => {
    const r = jstMonthRange('2026-09')!;
    // JST 2026-09-01 00:00 = UTC 2026-08-31 15:00
    expect(r.from.toISOString()).toBe('2026-08-31T15:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('日本時間 1日 未明の決済が前月に漏れない', () => {
    // UTC で月初を作ると JST 1日 0:00〜8:59 が前月に入ってしまう。
    const r = jstMonthRange('2026-09')!;
    const jstFirstDayEarly = new Date('2026-08-31T15:30:00Z'); // JST 9/1 00:30
    expect(jstFirstDayEarly >= r.from).toBe(true);
    expect(jstFirstDayEarly < r.to).toBe(true);
  });

  it('月末 23:59:59.999 が含まれ、翌月初は含まれない', () => {
    const r = jstMonthRange('2026-09')!;
    const lastMoment = new Date('2026-09-30T14:59:59.999Z'); // JST 9/30 23:59:59.999
    expect(lastMoment < r.to).toBe(true);
    const nextMonth = new Date('2026-09-30T15:00:00.000Z'); // JST 10/1 00:00
    expect(nextMonth < r.to).toBe(false);
  });

  it('12月は翌年1月へ正しく繰り上がる', () => {
    const r = jstMonthRange('2026-12')!;
    expect(r.to.toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('うるう年の2月も扱える', () => {
    const r = jstMonthRange('2028-02')!;
    expect(r.to.toISOString()).toBe('2028-02-29T15:00:00.000Z');
  });

  it('不正な入力は null', () => {
    for (const bad of ['', '2026', '2026-13', '2026-00', 'abc', '26-09', '1999-01']) {
      expect(jstMonthRange(bad)).toBeNull();
    }
  });

  it('前後の空白は許容する', () => {
    expect(jstMonthRange(' 2026-09 ')).not.toBeNull();
  });
});

describe('formatMonthLabel / currentJstMonth / recentJstMonths', () => {
  it('見出し用の和文ラベルに変換する', () => {
    expect(formatMonthLabel('2026-09')).toBe('2026年9月');
    expect(formatMonthLabel('2026-12')).toBe('2026年12月');
  });

  it('不正な値はそのまま返す (画面が壊れないように)', () => {
    expect(formatMonthLabel('bad')).toBe('bad');
  });

  it('JST 基準で当月を返す (UTC 深夜でも翌日にならない)', () => {
    // UTC 2026-08-31 16:00 は JST では 9/1。当月は 2026-09 になる。
    expect(currentJstMonth(new Date('2026-08-31T16:00:00Z'))).toBe('2026-09');
    expect(currentJstMonth(new Date('2026-08-31T14:00:00Z'))).toBe('2026-08');
  });

  it('直近の月を新しい順で返し、年を跨いでも正しい', () => {
    expect(recentJstMonths(3, new Date('2026-02-15T00:00:00Z'))).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
    ]);
  });

  it('未来の月は含めない (先頭が当月)', () => {
    const list = recentJstMonths(6, new Date('2026-09-10T00:00:00Z'));
    expect(list[0]).toBe('2026-09');
    expect(list).toHaveLength(6);
  });
});

/**
 * 「手数料が 1 件も取れていない」状態の判定。
 *
 * ここを誤ると PDF に «手数料 ¥0 / 差引入金額 = 売上全額» と表示され、
 * 経理が «手数料ゼロで満額入金された» と誤読する。
 * 実際は金額が «分からない» だけなので、金額を出さない分岐が必要。
 */
describe('isFeeTotallyUnavailable', () => {
  const sum = (payments: ReportPayment[]) => summarizePayments(payments);

  it('全件の手数料が取得できていないとき true', () => {
    expect(
      isFeeTotallyUnavailable(sum([pay({ feeAmount: null }), pay({ feeAmount: null })])),
    ).toBe(true);
  });

  it('1 件でも取得できていれば false (合計を出してよい)', () => {
    expect(
      isFeeTotallyUnavailable(sum([pay({ feeAmount: null }), pay({ feeAmount: 24 })])),
    ).toBe(false);
  });

  it('全件取得できていれば false', () => {
    expect(isFeeTotallyUnavailable(sum([pay({ feeAmount: 24 })]))).toBe(false);
  });

  it('決済が 0 件のときは false (「取得不可」ではなく単に売上ゼロ)', () => {
    expect(isFeeTotallyUnavailable(sum([]))).toBe(false);
  });

  it('手数料が実際に 0 円だった場合は false (取得はできている)', () => {
    // 手数料 0 円の決済も理論上あり得る。取得できている以上「不明」ではない。
    expect(isFeeTotallyUnavailable(sum([pay({ feeAmount: 0 })]))).toBe(false);
  });
});
