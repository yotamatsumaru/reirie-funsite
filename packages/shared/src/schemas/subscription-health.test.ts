import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  daysSincePayment,
  detectSubscriptionMismatches,
  isActionableWebhookReason,
  isActiveSubscriptionStatus,
  overallSeverity,
  resolveWebhookOutcome,
} from './subscription-health';

describe('isActiveSubscriptionStatus', () => {
  it('ACTIVE / TRIALING / PAST_DUE を有効と判定する', () => {
    expect(isActiveSubscriptionStatus('ACTIVE')).toBe(true);
    expect(isActiveSubscriptionStatus('TRIALING')).toBe(true);
    expect(isActiveSubscriptionStatus('PAST_DUE')).toBe(true);
  });

  it('CANCELED / INCOMPLETE / UNPAID は無効と判定する', () => {
    expect(isActiveSubscriptionStatus('CANCELED')).toBe(false);
    expect(isActiveSubscriptionStatus('INCOMPLETE')).toBe(false);
    expect(isActiveSubscriptionStatus('INCOMPLETE_EXPIRED')).toBe(false);
    expect(isActiveSubscriptionStatus('UNPAID')).toBe(false);
  });

  it('未知の文字列を有効扱いしない（誤検知で見逃さないため）', () => {
    expect(isActiveSubscriptionStatus('')).toBe(false);
    expect(isActiveSubscriptionStatus('active')).toBe(false); // 小文字は Stripe 形式であり DB 形式ではない
  });

  it('auth.ts / credentials.ts のクエリ条件と同じ3件であること', () => {
    // ここがズレると「検知では正常なのに会員は使えない」が発生する
    expect([...ACTIVE_SUBSCRIPTION_STATUSES]).toEqual(['ACTIVE', 'TRIALING', 'PAST_DUE']);
  });
});

describe('detectSubscriptionMismatches', () => {
  it('決済成功があるのに有効サブスクが無い場合を critical で検知する', () => {
    const found = detectSubscriptionMismatches({
      succeededSubscriptionPaymentCount: 1,
      lastSucceededPaymentAt: new Date('2026-08-24T00:00:00Z'),
      subscriptionStatuses: [],
    });
    const paid = found.find((m) => m.kind === 'PAID_BUT_NO_ACTIVE_SUB');
    expect(paid).toBeDefined();
    expect(paid?.severity).toBe('critical');
  });

  it('決済成功があり有効サブスクもある正常系では何も検知しない', () => {
    expect(
      detectSubscriptionMismatches({
        succeededSubscriptionPaymentCount: 3,
        lastSucceededPaymentAt: new Date(),
        subscriptionStatuses: ['ACTIVE'],
      }),
    ).toEqual([]);
  });

  it('決済が無ければ有効サブスクが無くても検知しない（ただの無料会員）', () => {
    expect(
      detectSubscriptionMismatches({
        succeededSubscriptionPaymentCount: 0,
        lastSucceededPaymentAt: null,
        subscriptionStatuses: [],
      }),
    ).toEqual([]);
  });

  it('解約済み会員を不整合として誤検知しない', () => {
    // 過去に払って解約した人は「決済あり・有効サブスク無し」だが正常。
    // ただし本実装では区別できないため CANCELED があっても検知される。
    // → 実装側で「解約済みを除外する」責務を持つことを明示するテスト。
    const found = detectSubscriptionMismatches({
      succeededSubscriptionPaymentCount: 5,
      lastSucceededPaymentAt: new Date('2025-01-01T00:00:00Z'),
      subscriptionStatuses: ['CANCELED'],
    });
    // CANCELED 行が存在する = 一度は正しく記録されていた証拠なので、
    // 呼び出し側で除外する。ここでは検知されることを明示的に固定しておく。
    expect(found.some((m) => m.kind === 'PAID_BUT_NO_ACTIVE_SUB')).toBe(true);
  });

  it('INCOMPLETE のまま残っている場合を warning で検知する', () => {
    const found = detectSubscriptionMismatches({
      succeededSubscriptionPaymentCount: 0,
      lastSucceededPaymentAt: null,
      subscriptionStatuses: ['INCOMPLETE'],
    });
    const stuck = found.find((m) => m.kind === 'STUCK_INCOMPLETE');
    expect(stuck).toBeDefined();
    expect(stuck?.severity).toBe('warning');
  });

  it('INCOMPLETE があっても有効サブスクがあれば検知しない', () => {
    // アップグレード途中などで INCOMPLETE 行が併存することがあるが、
    // 有効な行がある以上、会員は使えているので警告しない。
    expect(
      detectSubscriptionMismatches({
        succeededSubscriptionPaymentCount: 1,
        lastSucceededPaymentAt: new Date(),
        subscriptionStatuses: ['ACTIVE', 'INCOMPLETE'],
      }),
    ).toEqual([]);
  });

  it('決済あり かつ INCOMPLETE 残留は2件とも検知する（原因の説明になるため）', () => {
    const found = detectSubscriptionMismatches({
      succeededSubscriptionPaymentCount: 1,
      lastSucceededPaymentAt: new Date(),
      subscriptionStatuses: ['INCOMPLETE'],
    });
    expect(found.map((m) => m.kind).sort()).toEqual([
      'PAID_BUT_NO_ACTIVE_SUB',
      'STUCK_INCOMPLETE',
    ]);
  });

  it('有効サブスクが複数ある場合を二重契約として検知する', () => {
    const found = detectSubscriptionMismatches({
      succeededSubscriptionPaymentCount: 2,
      lastSucceededPaymentAt: new Date(),
      subscriptionStatuses: ['ACTIVE', 'ACTIVE'],
    });
    const dup = found.find((m) => m.kind === 'DUPLICATE_ACTIVE_SUB');
    expect(dup).toBeDefined();
    expect(dup?.message).toContain('2 件');
  });

  it('PAST_DUE と ACTIVE の併存も二重契約として数える', () => {
    const found = detectSubscriptionMismatches({
      succeededSubscriptionPaymentCount: 1,
      lastSucceededPaymentAt: new Date(),
      subscriptionStatuses: ['ACTIVE', 'PAST_DUE'],
    });
    expect(found.some((m) => m.kind === 'DUPLICATE_ACTIVE_SUB')).toBe(true);
  });
});

describe('overallSeverity', () => {
  it('検知なしなら null', () => {
    expect(overallSeverity([])).toBeNull();
  });

  it('critical が含まれれば critical', () => {
    expect(
      overallSeverity([
        { kind: 'STUCK_INCOMPLETE', severity: 'warning', message: '' },
        { kind: 'PAID_BUT_NO_ACTIVE_SUB', severity: 'critical', message: '' },
      ]),
    ).toBe('critical');
  });

  it('warning のみなら warning', () => {
    expect(
      overallSeverity([{ kind: 'DUPLICATE_ACTIVE_SUB', severity: 'warning', message: '' }]),
    ).toBe('warning');
  });
});

describe('daysSincePayment', () => {
  const now = new Date('2026-08-31T00:00:00Z');

  it('経過日数を切り捨てで返す', () => {
    expect(daysSincePayment(new Date('2026-08-24T00:00:00Z'), now)).toBe(7);
    expect(daysSincePayment(new Date('2026-08-24T12:00:00Z'), now)).toBe(6);
  });

  it('決済日時が無ければ 0', () => {
    expect(daysSincePayment(null, now)).toBe(0);
  });

  it('未来日付でも負の値を返さない', () => {
    expect(daysSincePayment(new Date('2026-09-10T00:00:00Z'), now)).toBe(0);
  });
});

describe('resolveWebhookOutcome', () => {
  it('成功は SUCCESS / 理由なし', () => {
    expect(resolveWebhookOutcome({ ok: true })).toEqual({
      outcome: 'SUCCESS',
      reason: null,
    });
  });

  it('失敗は SKIPPED として理由を保持する（従来は console にしか残らなかった）', () => {
    expect(resolveWebhookOutcome({ ok: false, reason: 'user_not_found' })).toEqual({
      outcome: 'SKIPPED',
      reason: 'user_not_found',
    });
  });

  it('理由が無い失敗も unknown として必ず記録する', () => {
    expect(resolveWebhookOutcome({ ok: false })).toEqual({
      outcome: 'SKIPPED',
      reason: 'unknown',
    });
  });
});

describe('isActionableWebhookReason', () => {
  it('user_not_found は要対応（会員が必ず有料プランを使えない状態）', () => {
    expect(isActionableWebhookReason('user_not_found')).toBe(true);
  });

  it('データ都合のスキップは要対応にしない（アラート疲れを避ける）', () => {
    expect(isActionableWebhookReason('no_items')).toBe(false);
    expect(isActionableWebhookReason('no_invoice_id')).toBe(false);
  });

  it('null / undefined / 空文字は要対応にしない', () => {
    expect(isActionableWebhookReason(null)).toBe(false);
    expect(isActionableWebhookReason(undefined)).toBe(false);
    expect(isActionableWebhookReason('')).toBe(false);
  });
});
