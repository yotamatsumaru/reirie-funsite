/**
 * スロットの永続化ロジック (recordSlotPlay / buySlotExtraPlay) のテスト。
 *
 * 検証したいのは主に以下:
 *  1. 上限チェック → 記録 → Pui 付与 が advisory lock の「後」に行われること。
 *     ロックが count より後だと Read-Modify-Write 競合を防げず、
 *     並列リクエストで上限を超えた Pui 付与 (= 不正取得) が成立してしまう。
 *  2. promo_until の読み取りがトランザクションの「外」で行われること。
 *     中で失敗すると PostgreSQL のトランザクションが aborted になり、
 *     以降の全クエリが落ちてゲームが 500 になる。
 *  3. 日次上限に達したら「記録も付与もしない」こと (accepted=false)。
 *  4. プラン倍率が Pui 付与に反映されること (二重適用していないこと)。
 *  5. あっち向いてホイと別のロックスコープを使い、互いにブロックしないこと。
 *
 * 実 DB は使わず、@idol/db を軽量なインメモリスタブに差し替えて検証する。
 */

type Call = { op: string; args: unknown[] };

const calls: Call[] = [];

/** miniGamePlay.count が返す「本日の既プレイ数」。上限テストで差し替える。 */
let playedTodayStub = 0;
/** subscription.findFirst が返すプラン (null なら FREE)。 */
let planStub: string | null = null;
/** promo_until の読み取りが失敗する状況 (マイグレーション未適用) を再現するフラグ。 */
let promoQueryShouldThrow = false;
/** miniGamePlay.create に渡されたデータ (付与額の検証用)。 */
let createdPlayData: Record<string, unknown> | null = null;
/** puiTransaction.create に渡されたデータ (付与額の検証用)。 */
let createdPuiTx: Record<string, unknown> | null = null;

function makeTx() {
  return {
    $executeRaw: (...args: unknown[]) => {
      calls.push({ op: '$executeRaw', args });
      return Promise.resolve(1);
    },
    subscription: {
      findFirst: () => {
        calls.push({ op: 'subscription.findFirst', args: [] });
        return Promise.resolve(planStub ? { planType: planStub } : null);
      },
    },
    miniGamePlay: {
      count: () => {
        calls.push({ op: 'miniGamePlay.count', args: [] });
        return Promise.resolve(playedTodayStub);
      },
      create: (args: unknown) => {
        calls.push({ op: 'miniGamePlay.create', args: [args] });
        createdPlayData = (args as { data: Record<string, unknown> }).data;
        return Promise.resolve({ id: 'play-1' });
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
      create: (args: unknown) => {
        calls.push({ op: 'miniGameExtraPlayPurchase.create', args: [args] });
        return Promise.resolve({});
      },
    },
    user: {
      findUnique: () => {
        calls.push({ op: 'user.findUnique', args: [] });
        return Promise.resolve({ pui: 100 });
      },
      update: () => {
        calls.push({ op: 'user.update', args: [] });
        return Promise.resolve({ pui: 100 });
      },
    },
    puiTransaction: {
      create: (args: unknown) => {
        calls.push({ op: 'puiTransaction.create', args: [args] });
        createdPuiTx = (args as { data: Record<string, unknown> }).data;
        return Promise.resolve({});
      },
    },
  };
}

jest.mock('@idol/db', () => {
  const prismaStub = {
    // safeGetPromoUntil はトランザクションの「外」でトップレベル prisma に対して呼ばれる。
    $queryRaw: (...args: unknown[]) => {
      calls.push({ op: '$queryRaw', args });
      if (promoQueryShouldThrow) {
        return Promise.reject(new Error('column "promo_until" does not exist'));
      }
      return Promise.resolve([]);
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
    miniGamePlay: {
      count: () => {
        calls.push({ op: 'top.miniGamePlay.count', args: [] });
        return Promise.resolve(playedTodayStub);
      },
    },
    miniGameExtraPlayPurchase: {
      findUnique: (args: unknown) => {
        calls.push({ op: 'top.miniGameExtraPlayPurchase.findUnique', args: [args] });
        return Promise.resolve(null);
      },
    },
  };
  return {
    prisma: prismaStub,
    Prisma: {
      sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
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
  recordSlotPlay,
  buySlotExtraPlay,
  getSlotPlayCountToday,
  getSlotExtraPlaysToday,
  getSlotEffectiveMaxPerDay,
} from './points';
import { SLOT_MAX_PLAYS_PER_DAY, SLOT_PAYOUT } from '@idol/shared';

const NOW = new Date('2026-08-10T03:00:00Z');

beforeEach(() => {
  calls.length = 0;
  playedTodayStub = 0;
  planStub = null;
  promoQueryShouldThrow = false;
  createdPlayData = null;
  createdPuiTx = null;
});

describe('recordSlotPlay の advisory lock', () => {
  it('トランザクションの最初に pg_advisory_xact_lock を取得する (上限 count より前)', async () => {
    await recordSlotPlay('user-1', 'LOSE', 0, undefined, NOW);

    const lockIdx = calls.findIndex((c) => c.op === '$executeRaw');
    const countIdx = calls.findIndex((c) => c.op === 'miniGamePlay.count');

    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(countIdx).toBeGreaterThanOrEqual(0);
    // ロックが上限チェックより後だと Read-Modify-Write 競合を防げない
    expect(lockIdx).toBeLessThan(countIdx);
  });

  it('promo_until の読み取りはトランザクション (advisory lock) より前に行う', async () => {
    await recordSlotPlay('user-1', 'LOSE', 0, undefined, NOW);

    const promoIdx = calls.findIndex((c) => c.op === '$queryRaw');
    const lockIdx = calls.findIndex((c) => c.op === '$executeRaw');

    expect(promoIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(promoIdx).toBeLessThan(lockIdx);
  });

  it('promo_until カラム未適用 (生 SQL が失敗) でも 500 にせずプレイを記録できる', async () => {
    promoQueryShouldThrow = true;

    const result = await recordSlotPlay('user-1', 'LOSE', 0, undefined, NOW);

    expect(result.accepted).toBe(true);
    expect(result.promoActive).toBe(false);
    expect(calls.some((c) => c.op === 'miniGamePlay.create')).toBe(true);
  });

  it('あっち向いてホイとは別のロックスコープを使う (互いにブロックしない)', () => {
    expect(hashStringToInt32('SLOT:play')).not.toBe(
      hashStringToInt32('ACCHI_MUITE_HOI:play'),
    );
  });
});

describe('recordSlotPlay の上限チェックと付与', () => {
  it('上限未満なら受理し、残り回数を返す', async () => {
    playedTodayStub = 2;
    const result = await recordSlotPlay('user-1', 'LOSE', 0, undefined, NOW);

    expect(result.accepted).toBe(true);
    expect(result.playedToday).toBe(3);
    expect(result.maxPerDay).toBe(SLOT_MAX_PLAYS_PER_DAY);
    expect(result.remaining).toBe(SLOT_MAX_PLAYS_PER_DAY - 3);
  });

  it('上限に達していたら受理せず、記録も Pui 付与もしない', async () => {
    playedTodayStub = SLOT_MAX_PLAYS_PER_DAY;

    const result = await recordSlotPlay('user-1', 'SEVEN_TRIPLE', 200, undefined, NOW);

    expect(result.accepted).toBe(false);
    expect(result.reward).toBe(0);
    expect(result.remaining).toBe(0);
    // 上限到達時は記録も付与も一切行わない (超過付与の防止)
    expect(calls.some((c) => c.op === 'miniGamePlay.create')).toBe(false);
    expect(calls.some((c) => c.op === 'puiTransaction.create')).toBe(false);
  });

  it('はずれのときは Pui を付与しない (記録のみ)', async () => {
    const result = await recordSlotPlay('user-1', 'LOSE', 0, undefined, NOW);

    expect(result.accepted).toBe(true);
    expect(result.reward).toBe(0);
    expect(calls.some((c) => c.op === 'miniGamePlay.create')).toBe(true);
    expect(calls.some((c) => c.op === 'puiTransaction.create')).toBe(false);
  });

  it('当たりのときは配当ぶんの Pui を付与する (FREE は倍率 1.0)', async () => {
    const result = await recordSlotPlay(
      'user-1',
      'BELL_TRIPLE',
      SLOT_PAYOUT.BELL_TRIPLE,
      undefined,
      NOW,
    );

    expect(result.accepted).toBe(true);
    expect(result.reward).toBe(SLOT_PAYOUT.BELL_TRIPLE);
    expect(createdPuiTx?.amount).toBe(SLOT_PAYOUT.BELL_TRIPLE);
    expect(createdPuiTx?.reason).toBe('GAME_REWARD');
  });

  it('プレミアム会員は Pui 付与率 (×2.0) が適用される', async () => {
    planStub = 'PREMIUM';

    const result = await recordSlotPlay(
      'user-1',
      'BELL_TRIPLE',
      SLOT_PAYOUT.BELL_TRIPLE,
      undefined,
      NOW,
    );

    expect(result.reward).toBe(SLOT_PAYOUT.BELL_TRIPLE * 2);
  });

  it('MiniGameResult は WIN/LOSE に丸め、役そのものは detail に残す', async () => {
    // MiniGameResult enum は WIN/LOSE/DRAW しか無いので、役 (SEVEN_TRIPLE 等) は
    // detail に JSON で保存する必要がある (集計・監査で役別に追えるようにするため)。
    const detail = JSON.stringify({ outcome: 'SEVEN_TRIPLE' });
    await recordSlotPlay('user-1', 'SEVEN_TRIPLE', SLOT_PAYOUT.SEVEN_TRIPLE, detail, NOW);

    expect(createdPlayData?.gameType).toBe('SLOT');
    expect(createdPlayData?.result).toBe('WIN');
    expect(createdPlayData?.rewardPui).toBe(SLOT_PAYOUT.SEVEN_TRIPLE);
    expect(createdPlayData?.detail).toBe(detail);
  });

  it('はずれの記録は result=LOSE になる', async () => {
    await recordSlotPlay('user-1', 'LOSE', 0, undefined, NOW);
    expect(createdPlayData?.result).toBe('LOSE');
    expect(createdPlayData?.rewardPui).toBe(0);
  });

  it('JST の日付キーで記録される', async () => {
    // 2026-08-10T03:00:00Z = JST 12:00 → 日付キーは 2026-08-10
    await recordSlotPlay('user-1', 'LOSE', 0, undefined, NOW);
    expect(createdPlayData?.date).toBe('2026-08-10');
  });
});

describe('buySlotExtraPlay', () => {
  it('トランザクションの最初に pg_advisory_xact_lock を取得する (購入上限 find より前)', async () => {
    await buySlotExtraPlay('user-1', NOW);

    const lockIdx = calls.findIndex((c) => c.op === '$executeRaw');
    const findIdx = calls.findIndex(
      (c) => c.op === 'miniGameExtraPlayPurchase.findUnique',
    );

    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(findIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeLessThan(findIdx);
  });

  it('購入すると gameType=SLOT の行が作られ、上限が 1 増える', async () => {
    const result = await buySlotExtraPlay('user-1', NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.purchasedToday).toBe(1);
      expect(result.maxPerDay).toBe(SLOT_MAX_PLAYS_PER_DAY + 1);
    }
    const createCall = calls.find((c) => c.op === 'miniGameExtraPlayPurchase.create');
    expect(createCall).toBeDefined();
    const data = (createCall!.args[0] as { data: Record<string, unknown> }).data;
    expect(data.gameType).toBe('SLOT');
  });
});

describe('プレイ回数の集計ヘルパ', () => {
  it('getSlotPlayCountToday は本日のプレイ数を返す', async () => {
    playedTodayStub = 3;
    await expect(getSlotPlayCountToday('user-1', NOW)).resolves.toBe(3);
  });

  it('getSlotExtraPlaysToday は購入行が無ければ 0', async () => {
    await expect(getSlotExtraPlaysToday('user-1', NOW)).resolves.toBe(0);
  });

  it('getSlotEffectiveMaxPerDay は標準上限 + 購入分', async () => {
    await expect(getSlotEffectiveMaxPerDay('user-1', NOW)).resolves.toBe(
      SLOT_MAX_PLAYS_PER_DAY,
    );
  });

  it('集計は gameType=SLOT で絞り込む (あっち向いてホイと混ざらない)', async () => {
    await getSlotExtraPlaysToday('user-1', NOW);
    const call = calls.find((c) => c.op === 'top.miniGameExtraPlayPurchase.findUnique');
    expect(call).toBeDefined();
    const where = (call!.args[0] as { where: { userId_gameType_date: { gameType: string } } })
      .where;
    expect(where.userId_gameType_date.gameType).toBe('SLOT');
  });
});
