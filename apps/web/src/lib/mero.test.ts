/**
 * Mero (上位ポイント) サービス層 (lib/mero.ts) のテスト。
 *
 * 【このテストが守っている仕様】
 *  1. 付与すると残高と履歴が同時に増える (履歴の balance は取引後の残高)
 *  2. 残高を超える減算は拒否され、残高も履歴も変わらない (ロールバック)
 *  3. 0 / 小数 / 上限超えは拒否する (誤入力による大量付与の防止)
 *  4. 存在しないユーザーへの付与は分かりやすいエラーになる
 *  5. Pui の残高には一切影響しない (別通貨として独立している)
 *
 * 実 DB は使わず、トランザクションを模したインメモリのスタブで検証する。
 */

type UserRow = { id: string; pui: number; mero: number };
type TxRow = {
  userId: string;
  amount: number;
  balance: number;
  reason: string;
  note: string | null;
  actorId: string | null;
};

let users: Record<string, UserRow> = {};
let ledger: TxRow[] = [];

/** トランザクション内の変更を、失敗時に巻き戻せるようにしたスタブ */
function makeClient(state: { users: Record<string, UserRow>; ledger: TxRow[] }) {
  return {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.users[where.id] ? { ...state.users[where.id] } : null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { mero: { increment: number } };
      }) => {
        const u = state.users[where.id];
        if (!u) throw Object.assign(new Error('not found'), { code: 'P2025' });
        u.mero += data.mero.increment;
        return { mero: u.mero };
      },
    },
    meroTransaction: {
      create: async ({ data }: { data: TxRow }) => {
        state.ledger.push({ ...data });
        return data;
      },
      findMany: async () => [],
    },
  };
}

jest.mock('@idol/db', () => ({
  prisma: {
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(users[where.id] ? { ...users[where.id] } : null),
    },
    // 本物の $transaction と同じく、途中で throw したら変更をすべて破棄する
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const draft = {
        users: JSON.parse(JSON.stringify(users)) as Record<string, UserRow>,
        ledger: [...ledger],
      };
      const result = await fn(makeClient(draft));
      users = draft.users;
      ledger = draft.ledger;
      return result;
    },
  },
  Prisma: { TransactionClient: class {} },
}));

import { adminAdjustMero, MeroIntegrityError } from './mero';
import { MAX_MERO_PER_TX } from '@idol/shared';

const USER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '99999999-9999-4999-8999-999999999999';

beforeEach(() => {
  users = { [USER]: { id: USER, pui: 500, mero: 0 } };
  ledger = [];
});

describe('adminAdjustMero', () => {
  it('付与すると残高と履歴が同時に増え、履歴の balance は取引後の残高になる', async () => {
    const balance = await adminAdjustMero({
      userId: USER,
      amount: 30,
      reason: 'LIVE_BENEFIT',
      note: '  11/23 ワンマン来場特典  ',
      actorId: ADMIN,
    });
    expect(balance).toBe(30);
    expect(users[USER].mero).toBe(30);
    expect(ledger).toEqual([
      {
        userId: USER,
        amount: 30,
        balance: 30,
        reason: 'LIVE_BENEFIT',
        note: '11/23 ワンマン来場特典',
        actorId: ADMIN,
      },
    ]);
  });

  it('残高の範囲内なら減算できる', async () => {
    await adminAdjustMero({ userId: USER, amount: 50, reason: 'MERCH_BENEFIT', actorId: ADMIN });
    const balance = await adminAdjustMero({
      userId: USER,
      amount: -20,
      reason: 'ADMIN_ADJUST',
      actorId: ADMIN,
    });
    expect(balance).toBe(30);
    expect(ledger.map((t) => t.balance)).toEqual([50, 30]);
  });

  it('残高を超える減算は拒否し、残高も履歴も変わらない (ロールバック)', async () => {
    await adminAdjustMero({ userId: USER, amount: 10, reason: 'LIVE_BENEFIT', actorId: ADMIN });
    await expect(
      adminAdjustMero({ userId: USER, amount: -11, reason: 'ADMIN_ADJUST', actorId: ADMIN }),
    ).rejects.toBeInstanceOf(MeroIntegrityError);
    expect(users[USER].mero).toBe(10);
    expect(ledger).toHaveLength(1);
  });

  it.each([
    ['0', 0],
    ['小数', 1.5],
    ['上限超え (付与)', MAX_MERO_PER_TX + 1],
    ['上限超え (減算)', -(MAX_MERO_PER_TX + 1)],
  ])('%s は拒否する', async (_label, amount) => {
    await expect(
      adminAdjustMero({ userId: USER, amount, reason: 'ADMIN_ADJUST', actorId: ADMIN }),
    ).rejects.toBeInstanceOf(MeroIntegrityError);
    expect(users[USER].mero).toBe(0);
    expect(ledger).toHaveLength(0);
  });

  it('存在しないユーザーへの付与は分かりやすいエラーにする', async () => {
    await expect(
      adminAdjustMero({
        userId: '22222222-2222-4222-8222-222222222222',
        amount: 10,
        reason: 'LIVE_BENEFIT',
        actorId: ADMIN,
      }),
    ).rejects.toThrow('対象ユーザーが見つかりません');
  });

  it('Pui の残高には影響しない (Mero は独立した通貨)', async () => {
    await adminAdjustMero({ userId: USER, amount: 100, reason: 'LIVE_BENEFIT', actorId: ADMIN });
    expect(users[USER].pui).toBe(500);
  });
});
