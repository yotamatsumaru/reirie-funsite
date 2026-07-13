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

/**
 * トップレベル prisma.$queryRaw (= promo_until の読み取り) が
 * 「column does not exist」で失敗する状況を再現するためのフラグ。
 * 本番でマイグレーション未適用のときに起きるケースを模す。
 */
let promoQueryShouldThrow = false;

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
    // promo_until の読み取り (safeGetPromoUntil) はトランザクションの「外」で
    // トップレベル prisma に対して呼ばれる。カラム未適用時は例外を投げる状況を再現する。
    $queryRaw: (...args: unknown[]) => {
      calls.push({ op: '$queryRaw', args });
      if (promoQueryShouldThrow) {
        return Promise.reject(
          new Error('column "promo_until" does not exist'),
        );
      }
      return Promise.resolve([]);
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  };
  return {
    prisma: prismaStub,
    Prisma: {
      // Prisma.sql タグ (safeGetPromoUntil で使用) のダミー
      sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
        strings,
        values,
      }),
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
  promoQueryShouldThrow = false;
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
    // 22003 (integer out of range) 対策: int8 → int4 へ確実にラップする演算を含むこと。
    // (Prisma がパラメータを int8 として送っても int4 範囲エラーにならないようにする)
    expect(sql).toContain('4294967295'); // 下位 32bit マスク
    expect(sql).toContain('4294967296'); // 2^32 での剰余
  });

  it('promo_until の読み取りはトランザクション (advisory lock) より前に行う', async () => {
    // これがトランザクション内だと、カラム未適用時に生 SQL が失敗して
    // トランザクションが aborted 状態になり、後続の create が全部落ちる。
    await recordAcchiPlay('user-1', 'LOSE', undefined, new Date('2026-07-13T00:00:00Z'));

    const promoIdx = calls.findIndex((c) => c.op === '$queryRaw');
    const lockIdx = calls.findIndex((c) => c.op === '$executeRaw');

    expect(promoIdx).toBeGreaterThanOrEqual(0); // promo_until を読んでいる
    expect(lockIdx).toBeGreaterThanOrEqual(0); // トランザクション内でロックしている
    // promo_until の読み取りは advisory lock (トランザクション開始) より前
    expect(promoIdx).toBeLessThan(lockIdx);
  });

  it('promo_until カラム未適用 (生 SQL が失敗) でも 500 にせずプレイを記録できる', async () => {
    // 本番でマイグレーション未適用のケースを再現。
    promoQueryShouldThrow = true;

    // safeGetPromoUntil はトランザクション外で呼ばれるため、ここで失敗しても
    // 後続のトランザクション (miniGamePlay.create 等) は汚染されず成功する。
    const result = await recordAcchiPlay(
      'user-1',
      'LOSE',
      undefined,
      new Date('2026-07-13T00:00:00Z'),
    );

    // プレイは受理され、プロモは無効 (通常アカウント) として扱われる
    expect(result.accepted).toBe(true);
    expect(result.promoActive).toBe(false);
    // トランザクション内でプレイ記録が作成されている (= aborted になっていない)
    expect(calls.some((c) => c.op === 'miniGamePlay.create')).toBe(true);
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
