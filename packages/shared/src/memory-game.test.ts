import {
  MEMORY_CARD_COUNT,
  MEMORY_CLEAR_BONUS,
  MEMORY_MAX_MOVES,
  MEMORY_MAX_PLAYS_PER_DAY,
  MEMORY_MAX_REWARD,
  MEMORY_PAIR_COUNT,
  MEMORY_PAIR_REWARD,
  buildMemoryCardViews,
  canFlipMemoryCard,
  isMemoryMatch,
  isMemorySessionExpired,
  isSafeMemoryCardViews,
  isValidMemoryBoard,
  memoryBoardSchema,
  memoryFlipSchema,
  memoryRemainingMoves,
  memoryRemainingPlays,
  memoryReward,
  resolveMemoryStatus,
  type MemoryBoard,
} from './memory-game';

/** テスト用に「0,0,1,1,2,2,...」と並んだ盤面を作る */
function makeBoard(pairCount = MEMORY_PAIR_COUNT): MemoryBoard {
  const cards: number[] = [];
  for (let i = 0; i < pairCount; i++) cards.push(i, i);
  return {
    cards,
    photos: Array.from({ length: pairCount }, (_, i) => ({
      id: `photo_${i}`,
      url: `/api/media/content-body-image/photo_${i}`,
      caption: `キャプション${i}`,
    })),
  };
}

describe('定数', () => {
  it('カード枚数はペア数の 2 倍', () => {
    expect(MEMORY_CARD_COUNT).toBe(MEMORY_PAIR_COUNT * 2);
  });

  it('理論最大報酬は「全ペア + クリアボーナス」と一致する', () => {
    expect(MEMORY_MAX_REWARD).toBe(
      MEMORY_PAIR_COUNT * MEMORY_PAIR_REWARD + MEMORY_CLEAR_BONUS,
    );
  });

  /**
   * 手数上限が理論最小手数 (= ペア数) 以下だと、
   * 完全に記憶していてもクリアが物理的に不可能になる。
   */
  it('手数上限は理論最小手数より大きい (クリア可能である)', () => {
    expect(MEMORY_MAX_MOVES).toBeGreaterThan(MEMORY_PAIR_COUNT);
  });

  it('1日のプレイ上限が設定されている', () => {
    expect(MEMORY_MAX_PLAYS_PER_DAY).toBeGreaterThan(0);
  });
});

describe('isValidMemoryBoard', () => {
  it('各ペアがちょうど 2 枚ある盤面は有効', () => {
    expect(isValidMemoryBoard(makeBoard())).toBe(true);
  });

  it('カード枚数がペア数の 2 倍でない盤面は無効', () => {
    const b = makeBoard(3);
    b.cards.pop();
    expect(isValidMemoryBoard(b)).toBe(false);
  });

  it('同じペアが 3 枚ある盤面は無効 (絶対に揃わないカードが生まれる)', () => {
    const b: MemoryBoard = {
      cards: [0, 0, 0, 1, 1, 2],
      photos: makeBoard(3).photos,
    };
    expect(isValidMemoryBoard(b)).toBe(false);
  });

  it('写真が存在しないペア番号を含む盤面は無効', () => {
    const b: MemoryBoard = { cards: [0, 0, 5, 5], photos: makeBoard(2).photos };
    expect(isValidMemoryBoard(b)).toBe(false);
  });

  it('写真が 0 枚なら無効', () => {
    expect(isValidMemoryBoard({ cards: [], photos: [] })).toBe(false);
  });

  it('負のペア番号は無効', () => {
    const b: MemoryBoard = { cards: [-1, -1, 0, 0], photos: makeBoard(2).photos };
    expect(isValidMemoryBoard(b)).toBe(false);
  });
});

describe('isMemoryMatch', () => {
  const board = makeBoard();

  it('同じペアなら一致', () => {
    // cards = [0,0,1,1,...] なので 0 と 1 は同じペア
    expect(isMemoryMatch(board, 0, 1)).toBe(true);
  });

  it('違うペアなら不一致', () => {
    expect(isMemoryMatch(board, 0, 2)).toBe(false);
  });

  /**
   * 同じカードを 2 回タップして «一致» になると、
   * 1 枚ずつ順にタップするだけで全ペア揃えられてしまう。
   */
  it('同じ位置を 2 回指定した場合は一致にしない', () => {
    expect(isMemoryMatch(board, 3, 3)).toBe(false);
  });

  it('範囲外の位置は一致にしない', () => {
    expect(isMemoryMatch(board, 0, 999)).toBe(false);
    expect(isMemoryMatch(board, -1, 0)).toBe(false);
  });
});

describe('canFlipMemoryCard', () => {
  it('未めくりのカードはめくれる', () => {
    expect(canFlipMemoryCard(5, [], null)).toBe(true);
  });

  it('すでに揃って確定したカードはめくれない', () => {
    expect(canFlipMemoryCard(5, [4, 5], null)).toBe(false);
  });

  it('1 枚目に選んだカードと同じ位置はめくれない', () => {
    expect(canFlipMemoryCard(5, [], 5)).toBe(false);
  });

  it('1 枚目とは別の位置ならめくれる', () => {
    expect(canFlipMemoryCard(6, [], 5)).toBe(true);
  });

  it('範囲外の位置はめくれない', () => {
    expect(canFlipMemoryCard(-1, [], null)).toBe(false);
    expect(canFlipMemoryCard(MEMORY_CARD_COUNT, [], null)).toBe(false);
    expect(canFlipMemoryCard(1.5, [], null)).toBe(false);
  });
});

describe('resolveMemoryStatus', () => {
  it('揃っていない・手数に余裕があれば PLAYING', () => {
    expect(resolveMemoryStatus(3, 5)).toBe('PLAYING');
  });

  it('全ペア揃えば CLEARED', () => {
    expect(resolveMemoryStatus(MEMORY_PAIR_COUNT, 10)).toBe('CLEARED');
  });

  it('手数上限に達すれば FAILED', () => {
    expect(resolveMemoryStatus(3, MEMORY_MAX_MOVES)).toBe('FAILED');
  });

  /**
   * 最後の 1 手でちょうど上限に達しつつ全ペア揃えたケース。
   * 手数超過を先に見ると「揃えたのに失敗」になり理不尽なので、
   * クリア判定が優先されることを固定する。
   */
  it('最後の手で上限に達しつつ全ペア揃えた場合は CLEARED を優先する', () => {
    expect(resolveMemoryStatus(MEMORY_PAIR_COUNT, MEMORY_MAX_MOVES)).toBe('CLEARED');
  });
});

describe('memoryReward', () => {
  it('揃えたペア数に応じて加算される', () => {
    expect(memoryReward(3, false)).toBe(3 * MEMORY_PAIR_REWARD);
  });

  it('クリア時はボーナスが付く', () => {
    expect(memoryReward(MEMORY_PAIR_COUNT, true)).toBe(MEMORY_MAX_REWARD);
  });

  it('1 ペアも揃えられなければ 0', () => {
    expect(memoryReward(0, false)).toBe(0);
  });

  it('途中終了でも揃えたぶんは受け取れる', () => {
    expect(memoryReward(2, false)).toBeGreaterThan(0);
  });

  it('負のペア数を渡されても負の報酬にはならない', () => {
    expect(memoryReward(-5, false)).toBe(0);
  });

  it('理論最大報酬を超えることはない', () => {
    expect(memoryReward(MEMORY_PAIR_COUNT, true)).toBeLessThanOrEqual(MEMORY_MAX_REWARD);
  });

  /**
   * 実機の通しプレイで観測した結果を回帰テストとして固定する。
   * (API 経由で実際に遊び、DB の mini_game_plays / pui_transactions と
   *  突き合わせて確認した値)
   *
   *   - 11 手で全 8 ペア達成 → WIN / 48 Pui
   *   - 20 手使い切って 2 ペア → LOSE / 8 Pui (クリアボーナスなし)
   *
   * 報酬計算を将来変更したときに、実際に付与された額と
   * 式が食い違ったままリリースされるのを防ぐ。
   */
  it('実機検証と同じ値になる: 全8ペア達成で 48 Pui', () => {
    expect(memoryReward(8, true)).toBe(48);
  });

  it('実機検証と同じ値になる: 手数切れで2ペアなら 8 Pui (ボーナスなし)', () => {
    expect(memoryReward(2, false)).toBe(8);
  });
});

describe('残り数の計算', () => {
  it('残りプレイ回数は負にならない', () => {
    expect(memoryRemainingPlays(999)).toBe(0);
    expect(memoryRemainingPlays(0)).toBe(MEMORY_MAX_PLAYS_PER_DAY);
  });

  it('残り手数は負にならない', () => {
    expect(memoryRemainingMoves(999)).toBe(0);
    expect(memoryRemainingMoves(0)).toBe(MEMORY_MAX_MOVES);
  });
});

describe('isMemorySessionExpired', () => {
  const start = new Date('2026-09-09T00:00:00Z');

  it('開始直後は期限切れでない', () => {
    expect(isMemorySessionExpired(start, new Date('2026-09-09T00:00:10Z'))).toBe(false);
  });

  it('TTL を超えたら期限切れ', () => {
    expect(isMemorySessionExpired(start, new Date('2026-09-09T01:00:00Z'))).toBe(true);
  });

  it('ちょうど TTL 時点では期限切れにしない (境界は含めない)', () => {
    expect(isMemorySessionExpired(start, new Date('2026-09-09T00:30:00Z'), 30)).toBe(false);
  });
});

/**
 * ★最重要★
 * 未めくりのカードに写真が含まれていないこと。
 * ここが崩れると、レスポンスを見るだけで全カードの位置が分かり、
 * ノーミスで Pui を稼げてしまう (ゲームが成立しない)。
 */
describe('buildMemoryCardViews — 盤面を漏らさない', () => {
  const board = makeBoard();

  it('未めくりのカードには写真を含めない', () => {
    const views = buildMemoryCardViews(board, [], []);
    expect(views).toHaveLength(MEMORY_CARD_COUNT);
    for (const v of views) {
      expect(v.faceUp).toBe(false);
      expect(v.photo).toBeUndefined();
    }
    expect(isSafeMemoryCardViews(views)).toBe(true);
  });

  it('めくり中のカードだけ写真を含める', () => {
    const views = buildMemoryCardViews(board, [], [2]);
    expect(views[2]!.faceUp).toBe(true);
    expect(views[2]!.photo).toEqual(board.photos[1]);
    // それ以外は伏せたまま
    expect(views.filter((v) => v.photo !== undefined)).toHaveLength(1);
    expect(isSafeMemoryCardViews(views)).toBe(true);
  });

  it('確定したペアは表かつ matched になる', () => {
    const views = buildMemoryCardViews(board, [0, 1], []);
    expect(views[0]!.matched).toBe(true);
    expect(views[0]!.faceUp).toBe(true);
    expect(views[0]!.photo).toEqual(board.photos[0]);
    expect(views[2]!.matched).toBe(false);
    expect(views[2]!.photo).toBeUndefined();
  });

  it('確定分とめくり中が混在しても、それ以外は伏せたまま', () => {
    const views = buildMemoryCardViews(board, [0, 1], [4]);
    const revealed = views.filter((v) => v.photo !== undefined).map((v) => v.index);
    expect(revealed.sort((a, b) => a - b)).toEqual([0, 1, 4]);
    expect(isSafeMemoryCardViews(views)).toBe(true);
  });

  it('全て揃った状態では全カードが表になる', () => {
    const all = board.cards.map((_, i) => i);
    const views = buildMemoryCardViews(board, all, []);
    expect(views.every((v) => v.faceUp && v.photo !== undefined)).toBe(true);
  });

  it('壊れた盤面 (写真が足りない) でも photo に undefined を入れない', () => {
    const broken: MemoryBoard = { cards: [0, 0, 9, 9], photos: [makeBoard(1).photos[0]!] };
    const views = buildMemoryCardViews(broken, [], [2]);
    // ペア 9 の写真は存在しないので photo は付かない
    expect(views[2]!.faceUp).toBe(true);
    expect(views[2]!.photo).toBeUndefined();
    expect(isSafeMemoryCardViews(views)).toBe(true);
  });
});

describe('isSafeMemoryCardViews', () => {
  it('伏せたカードに写真が入っていたら false (漏洩を検出する)', () => {
    expect(
      isSafeMemoryCardViews([
        { index: 0, faceUp: false, matched: false, photo: { id: 'x', url: '/x' } },
      ]),
    ).toBe(false);
  });

  it('表のカードに写真が入っているのは正常', () => {
    expect(
      isSafeMemoryCardViews([
        { index: 0, faceUp: true, matched: false, photo: { id: 'x', url: '/x' } },
      ]),
    ).toBe(true);
  });
});

describe('スキーマ', () => {
  it('めくりリクエストは位置のみを受け付ける', () => {
    expect(memoryFlipSchema.parse({ index: 3 })).toEqual({ index: 3 });
  });

  it('範囲外の位置は拒否する', () => {
    expect(memoryFlipSchema.safeParse({ index: -1 }).success).toBe(false);
    expect(memoryFlipSchema.safeParse({ index: MEMORY_CARD_COUNT }).success).toBe(false);
    expect(memoryFlipSchema.safeParse({ index: 1.5 }).success).toBe(false);
  });

  /**
   * 報酬や結果をクライアントから受け取らないことが不正防止の要。
   * 余計なキーが来ても無視されることを確認する。
   */
  it('reward などの余計なキーは結果に反映されない', () => {
    const parsed = memoryFlipSchema.parse({ index: 1, reward: 9999, matched: true });
    expect(parsed).toEqual({ index: 1 });
    expect('reward' in parsed).toBe(false);
  });

  it('保存済み盤面 JSON を検証できる', () => {
    const board = makeBoard(2);
    expect(memoryBoardSchema.safeParse(board).success).toBe(true);
    expect(memoryBoardSchema.safeParse({ cards: 'x', photos: [] }).success).toBe(false);
  });
});
