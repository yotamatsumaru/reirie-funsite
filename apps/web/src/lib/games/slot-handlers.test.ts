/**
 * スロット API ハンドラ (slot-handlers.ts) のテスト。
 *
 * 【このテストが守っている仕様】
 *  1. ゲーム非公開中は GET / POST / 追加プレイ購入 のすべてが 404 になる
 *     (ページを隠しても API が生きていれば直接叩けてしまうため)
 *  2. 追加プレイ購入では「Pui を消費する前に」可視性ガードが走る
 *     (遊べないゲームの権利を買わせると返金対応が発生する)
 *  3. recordSlotPlay には「プラン倍率適用前のベース配当」を渡す
 *     (倍率は recordSlotPlay 内で掛かるので、ここで掛けると二重適用になる)
 *  4. 出玉設定はクライアント申告ではなく DB のサブスクリプションから解決する
 *  5. 監査ログに game=SLOT と役・設定が残る (当たったときだけ)
 *  6. 上限超過は 429 で返る
 *
 * 実 DB・実セッションは使わず、依存モジュールをスタブに差し替えて検証する。
 * 抽選ロジック (lib/games/slot.ts) だけは本物を使い、
 * 「返したリールと役が矛盾しない」ことも併せて確認する。
 */
import {
  SLOT_PAYOUT,
  SLOT_MAX_PAYOUT,
  SLOT_MAX_PLAYS_PER_DAY,
  EXTRA_PLAY_COST_PUI,
  MAX_EXTRA_PLAYS_PER_DAY,
  judgeSlotReels,
  type SlotOutcome,
  type SlotSetting,
} from '@idol/shared';

// ---------------------------------------------------------------------------
// スタブの状態 (beforeEach でリセット)
// ---------------------------------------------------------------------------

/** ゲームが公開中かどうか。false なら requireGameVisible が 404 を投げる */
let gameVisible = true;
/** requireGameVisible / requireApiPrincipal / buySlotExtraPlay などの呼び出し順 */
let calls: string[] = [];
/**
 * 可視性ガードに渡されたゲームキー。
 * ここが 'slot' 以外だと「スロットを非公開にしたのに遊べる / 別のゲームを
 * 非公開にしたらスロットが消える」という取り違えになるため、必ず検証する。
 */
let guardedGames: string[] = [];

/** DB 上の有効サブスクリプション (null = 無料会員) */
let subscription: { planType: string } | null = null;
/** promo_until の値 (プロモ中なら未来日時) */
let promoUntil: Date | null = null;
/** users.pui */
let userPui = 1000;
/** 本日のプレイ数 / 追加購入数 */
let playedToday = 0;
let purchasedExtra = 0;

/** recordSlotPlay が受け取った引数 */
let recordArgs: {
  userId: string;
  outcome: SlotOutcome;
  basePayout: number;
  detail?: string;
} | null = null;
/** recordSlotPlay の戻り値を上書きしたいとき */
let recordAccepted = true;
let recordReward = 0;

/** buySlotExtraPlay の戻り値 */
let buyOk = true;
/** 作成された監査ログ */
let auditLogs: Array<{
  action: string;
  metadata?: Record<string, unknown>;
}> = [];

// ---------------------------------------------------------------------------
// モジュールモック
// ---------------------------------------------------------------------------

jest.mock('@/lib/game-visibility', () => ({
  requireGameVisible: jest.fn(async (_req: Request, game: string) => {
    calls.push('requireGameVisible');
    guardedGames.push(game);
    if (!gameVisible) {
      // 本物と同じく ApiError(404) を投げる
      const { errors } = jest.requireActual('@/lib/errors');
      throw errors.notFound('ゲームは現在非公開です');
    }
  }),
}));

jest.mock('@/lib/api-auth', () => ({
  requireApiPrincipal: jest.fn(async () => {
    calls.push('requireApiPrincipal');
    return {
      userId: 'user-1',
      email: 'u@example.com',
      role: 'MEMBER',
      // JWT 側のプランはあえて食い違わせておく。
      // 出玉設定がこちらを見ていたらテストが落ちる。
      plan: 'PREMIUM',
      capabilities: [],
      source: 'cookie' as const,
    };
  }),
}));

jest.mock('@idol/db', () => ({
  prisma: {
    subscription: {
      findFirst: async () => {
        calls.push('subscription.findFirst');
        return subscription;
      },
    },
    user: {
      findUnique: async () => ({ pui: userPui }),
    },
  },
}));

jest.mock('@/lib/points', () => ({
  PROMO_UNLIMITED_REMAINING: 9999,
  safeGetPromoUntil: async () => promoUntil,
  getSlotPlayCountToday: async () => playedToday,
  getSlotExtraPlaysToday: async () => purchasedExtra,
  recordSlotPlay: async (
    userId: string,
    outcome: SlotOutcome,
    basePayout: number,
    detail?: string,
  ) => {
    calls.push('recordSlotPlay');
    recordArgs = { userId, outcome, basePayout, detail };
    if (!recordAccepted) {
      return {
        accepted: false as const,
        promoActive: false,
        reward: 0,
        balance: userPui,
        playedToday,
        remaining: 0,
        maxPerDay: SLOT_MAX_PLAYS_PER_DAY,
      };
    }
    return {
      accepted: true as const,
      playId: 'play-1',
      promoActive: false,
      reward: recordReward,
      balance: userPui + recordReward,
      playedToday: playedToday + 1,
      remaining: SLOT_MAX_PLAYS_PER_DAY - (playedToday + 1),
      maxPerDay: SLOT_MAX_PLAYS_PER_DAY,
    };
  },
  buySlotExtraPlay: async () => {
    calls.push('buySlotExtraPlay');
    if (!buyOk) return { ok: false as const, reason: 'LIMIT_REACHED' as const };
    return {
      ok: true as const,
      balance: userPui - EXTRA_PLAY_COST_PUI,
      purchasedToday: purchasedExtra + 1,
      maxPerDay: SLOT_MAX_PLAYS_PER_DAY + purchasedExtra + 1,
    };
  },
}));

/** 出玉設定 (プラン → 設定 1〜6)。テストごとに書き換える */
let slotSettings: Record<string, SlotSetting> = {
  FREE: 1,
  STANDARD: 3,
  PREMIUM: 6,
};

jest.mock('@/lib/app-setting', () => ({
  getSlotSettings: async () => {
    calls.push('getSlotSettings');
    return slotSettings;
  },
}));

jest.mock('@/lib/audit', () => ({
  logAudit: async (params: {
    action: string;
    metadata?: Record<string, unknown>;
  }) => {
    calls.push('logAudit');
    auditLogs.push(params);
  },
}));

import {
  handleSlotGet,
  handleSlotPost,
  handleSlotBuyExtraPlay,
} from './slot-handlers';
import { ApiError } from '@/lib/errors';

const req = () => new Request('https://example.com/api/me/games/slot');

/** ハンドラを呼び、投げられた ApiError を取得する */
async function catchApiError(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('ApiError が投げられませんでした');
}

beforeEach(() => {
  gameVisible = true;
  calls = [];
  guardedGames = [];
  subscription = null;
  promoUntil = null;
  userPui = 1000;
  playedToday = 0;
  purchasedExtra = 0;
  recordArgs = null;
  recordAccepted = true;
  recordReward = 0;
  buyOk = true;
  auditLogs = [];
  slotSettings = { FREE: 1, STANDARD: 3, PREMIUM: 6 };
});

// ---------------------------------------------------------------------------

describe('ゲーム非公開中のガード', () => {
  it('GET は 404 になる (残り回数すら返さない)', async () => {
    gameVisible = false;
    const err = await catchApiError(() => handleSlotGet(req()));
    expect(err.status).toBe(404);
  });

  it('POST は 404 になり、プレイが記録されない', async () => {
    gameVisible = false;
    const err = await catchApiError(() => handleSlotPost(req()));
    expect(err.status).toBe(404);
    expect(recordArgs).toBeNull();
    expect(calls).not.toContain('recordSlotPlay');
  });

  it('追加プレイ購入は 404 になり、Pui を消費しない', async () => {
    gameVisible = false;
    const err = await catchApiError(() => handleSlotBuyExtraPlay(req()));
    expect(err.status).toBe(404);
    expect(calls).not.toContain('buySlotExtraPlay');
  });

  it('可視性ガードは Pui 消費 (購入処理) より前に実行される', async () => {
    // 公開中でも「順序」自体が正しいことを確認しておく。
    // 将来ガードが購入処理の後ろに移動したら、非公開時に Pui が減ってしまう。
    await handleSlotBuyExtraPlay(req());
    expect(calls.indexOf('requireGameVisible')).toBeLessThan(
      calls.indexOf('buySlotExtraPlay'),
    );
  });

  it('可視性ガードは認証より前に実行される (未公開機能の存在を隠す)', async () => {
    await handleSlotGet(req());
    expect(calls.indexOf('requireGameVisible')).toBeLessThan(
      calls.indexOf('requireApiPrincipal'),
    );
  });

  it('403 ではなく 404 を返す (未公開機能の存在自体を明かさない)', async () => {
    gameVisible = false;
    const err = await catchApiError(() => handleSlotPost(req()));
    expect(err.status).not.toBe(403);
    expect(err.status).toBe(404);
  });

  it("全ハンドラが 'slot' をキーにガードする (ゲームの取り違え防止)", async () => {
    // ゲーム個別の公開設定はこのキーで引かれる。'acchi' 等を渡していると
    // 「スロットを非公開にしたのに遊べる / 別ゲームを隠したらスロットが消える」
    // という取り違えになるが、型だけでは防げないので実行時に検証する。
    await handleSlotGet(req());
    await handleSlotPost(req());
    await handleSlotBuyExtraPlay(req());
    expect(guardedGames).toEqual(['slot', 'slot', 'slot']);
  });
});

describe('GET /games/slot', () => {
  it('配当表をサーバーから返す (クライアントにハードコードさせない)', async () => {
    const res = await handleSlotGet(req());
    const body = await res.json();
    expect(body.payouts).toEqual(SLOT_PAYOUT);
    expect(body.maxPayout).toBe(SLOT_MAX_PAYOUT);
  });

  it('残り回数 = 上限 - 本日のプレイ数', async () => {
    playedToday = 2;
    const res = await handleSlotGet(req());
    const body = await res.json();
    expect(body.playedToday).toBe(2);
    expect(body.maxPerDay).toBe(SLOT_MAX_PLAYS_PER_DAY);
    expect(body.remaining).toBe(SLOT_MAX_PLAYS_PER_DAY - 2);
    expect(body.promoActive).toBe(false);
  });

  it('追加プレイを購入していれば上限が増える', async () => {
    purchasedExtra = 2;
    playedToday = SLOT_MAX_PLAYS_PER_DAY;
    const res = await handleSlotGet(req());
    const body = await res.json();
    expect(body.baseMaxPerDay).toBe(SLOT_MAX_PLAYS_PER_DAY);
    expect(body.maxPerDay).toBe(SLOT_MAX_PLAYS_PER_DAY + 2);
    expect(body.remaining).toBe(2);
  });

  it('上限に達していたら残りは 0 (マイナスにならない)', async () => {
    playedToday = SLOT_MAX_PLAYS_PER_DAY + 10;
    const res = await handleSlotGet(req());
    const body = await res.json();
    expect(body.remaining).toBe(0);
  });

  it('プロモ期間中は回数無制限として返す', async () => {
    promoUntil = new Date(Date.now() + 60 * 60 * 1000);
    playedToday = 99;
    const res = await handleSlotGet(req());
    const body = await res.json();
    expect(body.promoActive).toBe(true);
    expect(body.remaining).toBe(9999);
  });

  it('追加プレイの購入状況と単価を返す', async () => {
    purchasedExtra = 1;
    const res = await handleSlotGet(req());
    const body = await res.json();
    expect(body.extraPlay).toEqual({
      purchasedToday: 1,
      maxPurchasesPerDay: MAX_EXTRA_PLAYS_PER_DAY,
      costPui: EXTRA_PLAY_COST_PUI,
      canBuyMore: true,
    });
  });

  it('購入上限に達したら canBuyMore=false', async () => {
    purchasedExtra = MAX_EXTRA_PLAYS_PER_DAY;
    const res = await handleSlotGet(req());
    const body = await res.json();
    expect(body.extraPlay.canBuyMore).toBe(false);
  });

  it('Pui 残高を返す', async () => {
    userPui = 777;
    const res = await handleSlotGet(req());
    const body = await res.json();
    expect(body.balance).toBe(777);
  });
});

describe('POST /games/slot (1 回転)', () => {
  it('返したリールと役が矛盾しない', async () => {
    // 抽選ロジックは本物を使うので、100 回まわして毎回整合しているか見る
    for (let i = 0; i < 100; i += 1) {
      calls = [];
      const res = await handleSlotPost(req());
      const body = await res.json();
      expect(judgeSlotReels(body.reels)).toBe(body.outcome);
    }
  });

  it('recordSlotPlay にはプラン倍率適用前のベース配当を渡す (二重適用の防止)', async () => {
    subscription = { planType: 'PREMIUM' };
    for (let i = 0; i < 60; i += 1) {
      recordArgs = null;
      await handleSlotPost(req());
      expect(recordArgs).not.toBeNull();
      // ×2.0 が既に掛かっていたらここで検出できる
      expect(recordArgs!.basePayout).toBe(SLOT_PAYOUT[recordArgs!.outcome]);
    }
  });

  it('detail に役・リール・プラン・設定を JSON で残す (監査/集計用)', async () => {
    subscription = { planType: 'STANDARD' };
    const res = await handleSlotPost(req());
    const body = await res.json();
    const detail = JSON.parse(recordArgs!.detail!);
    expect(detail.outcome).toBe(body.outcome);
    expect(detail.reels).toEqual(body.reels);
    expect(detail.plan).toBe('STANDARD');
    expect(detail.setting).toBe(slotSettings.STANDARD);
    expect(detail.basePayout).toBe(SLOT_PAYOUT[body.outcome as SlotOutcome]);
  });

  it('出玉設定は DB のサブスクリプションから解決する (JWT のプランを信用しない)', async () => {
    // requireApiPrincipal のスタブは plan=PREMIUM を返すが、DB 上は無料会員。
    subscription = null;
    await handleSlotPost(req());
    const detail = JSON.parse(recordArgs!.detail!);
    expect(detail.plan).toBe('FREE');
    expect(detail.setting).toBe(slotSettings.FREE);
  });

  it('有効なサブスクリプションがあればそのプランの設定を使う', async () => {
    subscription = { planType: 'STANDARD' };
    await handleSlotPost(req());
    const detail = JSON.parse(recordArgs!.detail!);
    expect(detail.plan).toBe('STANDARD');
    expect(detail.setting).toBe(3);
  });

  it('プロモ期間中は PREMIUM 相当の設定になる', async () => {
    promoUntil = new Date(Date.now() + 60 * 60 * 1000);
    subscription = null;
    await handleSlotPost(req());
    const detail = JSON.parse(recordArgs!.detail!);
    expect(detail.plan).toBe('PREMIUM');
    expect(detail.setting).toBe(6);
  });

  it('プランごとに設定が変わる (運営が出玉を出し分けられる)', async () => {
    slotSettings = { FREE: 1, STANDARD: 2, PREMIUM: 5 };
    for (const [planType, expected] of [
      ['STANDARD', 2],
      ['PREMIUM', 5],
    ] as const) {
      subscription = { planType };
      await handleSlotPost(req());
      expect(JSON.parse(recordArgs!.detail!).setting).toBe(expected);
    }
  });

  it('付与された Pui と残高をレスポンスに含める', async () => {
    recordReward = 40;
    userPui = 500;
    const res = await handleSlotPost(req());
    const body = await res.json();
    expect(body.reward).toBe(40);
    expect(body.balance).toBe(540);
  });

  it('上限超過なら 429 を返す', async () => {
    recordAccepted = false;
    const err = await catchApiError(() => handleSlotPost(req()));
    expect(err.status).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
  });

  it('上限超過のときは監査ログを書かない', async () => {
    recordAccepted = false;
    await catchApiError(() => handleSlotPost(req()));
    expect(auditLogs).toHaveLength(0);
  });

  it('当たったときは game=SLOT の監査ログを残す', async () => {
    recordReward = 100;
    subscription = { planType: 'STANDARD' };
    const res = await handleSlotPost(req());
    const body = await res.json();
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe('points.game_reward');
    expect(auditLogs[0].metadata).toMatchObject({
      game: 'SLOT',
      amount: 100,
      result: body.outcome,
      via: 'cookie',
      plan: 'STANDARD',
      setting: 3,
    });
  });

  it('はずれ (付与 0) のときは監査ログを書かない (ログを肥大させない)', async () => {
    recordReward = 0;
    await handleSlotPost(req());
    expect(auditLogs).toHaveLength(0);
  });

  it('リクエストボディを読まない (クライアント入力は結果に影響しない)', async () => {
    // 細工したボディを送っても 7 揃い固定にはならない。
    const malicious = new Request('https://example.com/api/me/games/slot', {
      method: 'POST',
      body: JSON.stringify({ outcome: 'SEVEN_TRIPLE', reward: 999999 }),
      headers: { 'content-type': 'application/json' },
    });
    const outcomes = new Set<string>();
    for (let i = 0; i < 80; i += 1) {
      const res = await handleSlotPost(malicious.clone());
      const body = await res.json();
      outcomes.add(body.outcome);
      expect(body.reward).not.toBe(999999);
    }
    // 全部 SEVEN_TRIPLE になっていない = ボディが無視されている
    expect(outcomes.size).toBeGreaterThan(1);
  });
});

describe('POST /games/slot/buy-extra-play', () => {
  it('購入すると残高が減り、上限が増える', async () => {
    userPui = 300;
    purchasedExtra = 0;
    const res = await handleSlotBuyExtraPlay(req());
    const body = await res.json();
    expect(body.balance).toBe(300 - EXTRA_PLAY_COST_PUI);
    expect(body.purchasedToday).toBe(1);
    expect(body.maxPerDay).toBe(SLOT_MAX_PLAYS_PER_DAY + 1);
    expect(body.cost).toBe(EXTRA_PLAY_COST_PUI);
  });

  it('購入上限に達していたら 429', async () => {
    buyOk = false;
    const err = await catchApiError(() => handleSlotBuyExtraPlay(req()));
    expect(err.status).toBe(429);
  });

  it('購入上限に達したときは監査ログを書かない', async () => {
    buyOk = false;
    await catchApiError(() => handleSlotBuyExtraPlay(req()));
    expect(auditLogs).toHaveLength(0);
  });

  it('購入成功時は game=SLOT の監査ログを残す', async () => {
    await handleSlotBuyExtraPlay(req());
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe('points.extra_play_purchase');
    expect(auditLogs[0].metadata).toMatchObject({
      game: 'SLOT',
      cost: EXTRA_PLAY_COST_PUI,
      purchasedToday: 1,
      via: 'cookie',
    });
  });
});
