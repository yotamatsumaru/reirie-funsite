/**
 * POST /api/subscriptions/sync-me の統合テスト。
 *
 * Checkout 成功直後の自己回復エンドポイント。以下の分岐を固定する:
 *  - 未認証 → 401
 *  - Stripe 顧客が未紐付け/未検証 → エラーにせず synced=false で 200 (UX を壊さない)
 *  - Stripe 側にサブスクが見つかる → DB へ upsert し、監査ログを記録して synced=true
 *  - 何も見つからない (Stripe 側が空) → 監査ログは記録せず synced=true, created=0
 */

export {};

let currentUserId: string | null = 'u1';

jest.mock('@/lib/api-auth', () => ({
  requireApiSession: jest.fn(async () => {
    if (!currentUserId) {
      const { errors } = jest.requireActual('@/lib/errors');
      throw errors.unauthorized();
    }
    return { user: { id: currentUserId } };
  }),
}));

let userRow: { id: string; stripeCustomerId: string | null } | null = {
  id: 'u1',
  stripeCustomerId: 'cus_123',
};

jest.mock('@idol/db', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async () => userRow),
    },
  },
}));

let stripeAvailable = true;
let verifiedCustomerId: string | null = 'cus_123';

jest.mock('@/lib/stripe', () => ({
  getStripe: jest.fn(async () => {
    if (!stripeAvailable) throw new Error('STRIPE_SECRET_KEY is not configured');
    return {} as unknown;
  }),
  verifyStripeCustomer: jest.fn(async () => verifiedCustomerId),
}));

let syncResult: { created: number; updated: number; results: unknown[] } = {
  created: 0,
  updated: 0,
  results: [],
};
let syncShouldThrow = false;

jest.mock('@/lib/subscription-sync', () => ({
  syncSubscriptionsForCustomer: jest.fn(async () => {
    if (syncShouldThrow) throw new Error('stripe api error');
    return syncResult;
  }),
}));

const logAuditMock = jest.fn(async (_args: unknown) => undefined);
jest.mock('@/lib/audit', () => ({
  logAudit: (args: unknown) => logAuditMock(args),
}));

async function post() {
  const { POST } = await import('./route');
  return POST(new Request('http://app/api/subscriptions/sync-me', { method: 'POST' }));
}

beforeEach(() => {
  currentUserId = 'u1';
  userRow = { id: 'u1', stripeCustomerId: 'cus_123' };
  stripeAvailable = true;
  verifiedCustomerId = 'cus_123';
  syncResult = { created: 0, updated: 0, results: [] };
  syncShouldThrow = false;
  logAuditMock.mockClear();
});

describe('POST /api/subscriptions/sync-me', () => {
  it('未認証なら 401', async () => {
    currentUserId = null;
    const res = await post();
    expect(res.status).toBe(401);
  });

  it('Stripe 顧客が未紐付けなら synced=false, 200 (エラーにしない)', async () => {
    verifiedCustomerId = null;
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, synced: false, reason: 'no_stripe_customer' });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('Stripe 未設定 (デモ環境等) なら synced=false, 200', async () => {
    stripeAvailable = false;
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, synced: false, reason: 'stripe_unavailable' });
  });

  it('Stripe 上にサブスクが見つかれば同期して監査ログを記録する (Webhook 取りこぼしの自己回復)', async () => {
    syncResult = {
      created: 1,
      updated: 0,
      results: [{ stripeSubscriptionId: 'sub_1', plan: 'STANDARD', status: 'ACTIVE' }],
    };
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.synced).toBe(true);
    expect(body.created).toBe(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        action: 'subscription.sync.self',
        resource: 'user:u1',
      }),
    );
  });

  it('Stripe 側に何も無ければ synced=true だが監査ログは記録しない (ノイズ防止)', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, synced: true, created: 0, updated: 0, results: [] });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('Stripe 呼び出しが失敗しても 500 にせず synced=false を返す (Checkout 直後の UX を守る)', async () => {
    syncShouldThrow = true;
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, synced: false, reason: 'stripe_error' });
  });

  it('ユーザーが見つからない場合も 200 で synced=false', async () => {
    userRow = null;
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, synced: false, reason: 'user_not_found' });
  });
});
