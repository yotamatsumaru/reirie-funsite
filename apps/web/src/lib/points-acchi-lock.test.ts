/**
 * あっちむいてPUI の日次上限まわりの競合対策 (advisory lock) に関するテスト。
 *
 * ここでは主に以下を検証する:
 *  1. hashStringToInt32 が決定論的で、PostgreSQL の int4 (符号付き 32bit) 範囲に収まること。
 *  2. recordAcchiPlay / buyAcchiExtraPlay がトランザクションの「最初」に
 *     pg_advisory_xact_lock を取得すること (= 上限チェックより前にロックする)。
 *     ロックが count/find より後だと Read-Modify-Write 競合を防げないため、
 *     「順序」が正当性の要になる。
 *
 * 実 DB は使わず、@idol/db を軽量なインメモリスタブに差し替えて検証する。
 */

// --- @idol/db を差し替え (実 DB / prisma 生成物に依存させない) ---
type Call = { op: string; args: unknown[] };

const calls: Call[] = [];

// トランザクションクライアントのスタブ。呼ばれた順序を calls に記録する。
function makeTx() {
  return {
    $executeRaw: (...args: unknown[]) => {
      calls.push({ op: '$executeRaw', args });
      return Promise.resolve(1);
    },
    subscription: {
      findFirst: () => {
        calls.push({ op: 'subscription.findFirst', args: [] });
        return Promise.resolve(null); // FREE 扱い
      },
    },
    miniGamePlay: {
      count: () => {
        calls.push({ op: 'miniGamePlay.count', args: [] });
        return Promise.resolve(0);
      },
      aggregate: () => {
        calls.push({ op: 'miniGamePlay.aggregate', args: [] });
        return Promise.resolve({ _sum: { bonusRewardPoint: 0 } });
      },
      create: () => {
        calls.push({ op: 'miniGamePlay.create', args: [] });
        return Promise.resolve({});
      },
    },
    miniGameExtraPlayPurchase: {
      findUnique: () => {
        calls.push({ op: 'miniGameExtraPlayPurchase.findUnique', args: [] });
        return Promise.resolve(null);
      },
      update: () => {
        calls.push({ op: 'miniGameExtraPlayPurchase.update', args: [] });
        return Promise.resolve({});
      },
      create: () => {
        calls.push({ op: 'miniGameExtraPlayPurchase.create', args: [] });
        return Promise.resolve({});
      },
    },
    user: {
      findUnique: () => {
        calls.push({ op: 'user.findUnique', args: [] });
        return Promise.resolve({ points: 100, rewardPoints: 0 });
      },
      update: () => {
        calls.push({ op: 'user.update', args: [] });
        return Promise.resolve({ points: 90, rewardPoints: 0 });
      },
    },
    pointTransaction: {
      create: () => {
        calls.push({ op: 'pointTransaction.create', args: [] });
        return Promise.resolve({});
      },
    },
    rewardPointTransaction: {
      create: () => {
        calls.push({ op: 'rewardPointTransaction.create', args: [] });
        return Promise.resolve({});
      },
    },
  };
}

jest.mock('@idol/db', () => {
  const prismaStub = {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  };
  return {
    prisma: prismaStub,
    Prisma: {
      // isUniqueViolation の instanceof チェック用ダミー
      PrismaClientKnownRequestError: class extends Error {
        code: string;
        constructor(msg: string, code: string) {
          super(msg);
          this.code = code;
        }
      },
    },
  };
});

// jest.mock の後に import する (ホイスティングされるので実際は先に評価される)
import {
  hashStringToInt32,
  recordAcchiPlay,
  buyAcchiExtraPlay,
} from './points';

beforeEach(() => {
  calls.length = 0;
});

describe('hashStringToInt32', () => {
  it('決定論的 (同じ入力 → 同じ出力)', () => {
    expect(hashStringToInt32('user-abc')).toBe(hashStringToInt32('user-abc'));
  });

  it('int4 (符号付き 32bit) の範囲に収まる整数を返す', () => {
    const samples = [
      '',
      'a',
      'ACCHI_MUITE_HOI:play',
      '11111111-2222-3333-4444-555555555555',
      '🎮ユーザー',
    ];
    for (const s of samples) {
      const v = hashStringToInt32(s);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-2147483648);
      expect(v).toBeLessThanOrEqual(2147483647);
    }
  });

  it('異なる入力は (実用上) 異なるキーになる', () => {
    expect(hashStringToInt32('userA')).not.toBe(hashStringToInt32('userB'));
    expect(hashStringToInt32('ACCHI_MUITE_HOI:play')).not.toBe(
      hashStringToInt32('OTHER_GAME:play'),
    );
  });
});

describe('recordAcchiPlay の advisory lock', () => {
  it('トランザクションの最初に pg_advisory_xact_lock を取得する (上限 count より前)', async () => {
    await recordAcchiPlay('user-1', 'LOSE', undefined, new Date('2026-07-13T00:00:00Z'));

    const lockIdx = calls.findIndex((c) => c.op === '$executeRaw');
    const countIdx = calls.findIndex((c) => c.op === 'miniGamePlay.count');

    expect(lockIdx).toBeGreaterThanOrEqual(0); // ロックが取得されている
    expect(countIdx).toBeGreaterThanOrEqual(0); // 上限チェックが行われている
    // ロックは上限チェック (count) より前でなければ Read-Modify-Write 競合を防げない
    expect(lockIdx).toBeLessThan(countIdx);
  });

  it('advisory lock の SQL に int キャストが含まれる', async () => {
    await recordAcchiPlay('user-1', 'LOSE', undefined, new Date('2026-07-13T00:00:00Z'));
    const lockCall = calls.find((c) => c.op === '$executeRaw');
    expect(lockCall).toBeDefined();
    // タグ付きテンプレートの第 1 引数 (TemplateStringsArray) に SQL 文字列が入る
    const templateParts = lockCall!.args[0] as unknown as string[];
    const sql = Array.isArray(templateParts) ? templateParts.join('') : String(templateParts);
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('::int');
  });
});

describe('buyAcchiExtraPlay の advisory lock', () => {
  it('トランザクションの最初に pg_advisory_xact_lock を取得する (購入上限 find より前)', async () => {
    await buyAcchiExtraPlay('user-1', new Date('2026-07-13T00:00:00Z'));

    const lockIdx = calls.findIndex((c) => c.op === '$executeRaw');
    const findIdx = calls.findIndex(
      (c) => c.op === 'miniGameExtraPlayPurchase.findUnique',
    );

    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(findIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeLessThan(findIdx);
  });
});
