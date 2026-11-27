jest.mock('@idol/db', () => ({ prisma: {} }));

import { explainAnnualMembership, jstDayRange, type MembershipSnapshot } from '@idol/shared';
import {
  buildFindings,
  normalizeMemberNumberInput,
  wasPremiumListedAt,
  type DiagnoseSubscription,
} from './newsletter-diagnose';

const day = jstDayRange('2026-08-15')!;
const now = new Date('2026-11-27T00:00:00Z');
// 2026-08-15 04:18 JST
const JOINED = '2026-08-14T19:18:00Z';

const snap = (over: Partial<MembershipSnapshot> = {}): MembershipSnapshot => ({
  planType: 'PREMIUM',
  billingInterval: 'YEAR',
  status: 'ACTIVE',
  createdAt: new Date(JOINED),
  currentPeriodStart: new Date(JOINED),
  currentPeriodEnd: new Date('2027-08-15T00:00:00Z'),
  canceledAt: null,
  updatedAt: new Date(JOINED),
  ...over,
});
const sub = (over: Partial<MembershipSnapshot> = {}): DiagnoseSubscription => {
  const s = snap(over);
  return { ...s, manual: false, explanation: explainAnnualMembership(s, day, now) };
};

describe('normalizeMemberNumberInput', () => {
  it('いろいろな書き方の会員番号を RR-000698 にそろえる', () => {
    for (const v of ['RR-000698', 'rr-000698', 'RR000698', '698', '000698', ' ＲＲ－０００６９８ ']) {
      expect(normalizeMemberNumberInput(v)).toBe('RR-000698');
    }
  });
  it('不正な入力は null', () => {
    expect(normalizeMemberNumberInput('')).toBeNull();
    expect(normalizeMemberNumberInput('abc')).toBeNull();
    expect(normalizeMemberNumberInput('RR-0')).toBeNull();
  });
});

describe('wasPremiumListedAt (旧来の宛名 CSV: ダウンロード時点の有効 PREMIUM 会員)', () => {
  it('8/15 04:18 JST 入会の人は、それより前にダウンロードした CSV には入らない', () => {
    expect(wasPremiumListedAt([snap()], new Date('2026-08-14T15:30:00Z'), now)).toBe(false); // 8/15 00:30 JST
    expect(wasPremiumListedAt([snap()], new Date('2026-08-14T19:17:59Z'), now)).toBe(false);
    expect(wasPremiumListedAt([snap()], new Date('2026-08-14T19:18:00Z'), now)).toBe(true);
    expect(wasPremiumListedAt([snap()], new Date('2026-08-16T00:00:00Z'), now)).toBe(true);
  });
  it('PREMIUM 以外は入らない', () => {
    expect(wasPremiumListedAt([snap({ planType: 'STANDARD' })], new Date('2026-09-01T00:00:00Z'), now)).toBe(false);
  });
});

describe('buildFindings', () => {
  const base = {
    deleted: false,
    banned: false,
    annualMember: true,
    missingFields: [] as string[],
    phoneMissing: false,
    exports: [],
  };

  it('ダウンロード済みの発送用 CSV がすべて入会前のものなら、それを原因として示す', () => {
    const f = buildFindings({
      ...base,
      subscriptions: [sub()],
      exports: [{ action: 'newsletter.export', at: new Date('2026-08-14T15:30:00Z'), cutoff: null, memberIncluded: false, exact: false }],
    });
    expect(f.join('\n')).toContain('いずれにも、この会員は入っていなかった');
  });

  it('PREMIUM なのに月額として記録されていると、年間会員の判定から外れることを示す', () => {
    const s = sub({ billingInterval: 'MONTH' });
    const f = buildFindings({ ...base, annualMember: false, subscriptions: [s] });
    expect(f.join('\n')).toContain('月額として記録');
  });

  it('住所の不足・電話番号なし・退会済みを示す', () => {
    expect(buildFindings({ ...base, subscriptions: [sub()], missingFields: ['郵便番号'] }).join('\n')).toContain('郵便番号');
    expect(buildFindings({ ...base, subscriptions: [sub()], phoneMissing: true }).join('\n')).toContain('電話番号');
    expect(buildFindings({ ...base, deleted: true, annualMember: false, subscriptions: [sub()] }).join('\n')).toContain('退会');
  });

  it('問題が見つからなければ、配送状況の確認を案内する', () => {
    const f = buildFindings({
      ...base,
      subscriptions: [sub()],
      exports: [{ action: 'newsletter.export', at: new Date('2026-08-20T00:00:00Z'), cutoff: null, memberIncluded: true, exact: false }],
    });
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('発送対象に入っています');
  });
});
