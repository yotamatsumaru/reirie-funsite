/**
 * ゲーム個別の公開 / 非公開ロジック (game-visibility.ts) のテスト。
 *
 * 【このテストが守っている仕様】
 *  1. マスタースイッチ (gamesVisible) と個別フラグの AND で公開判定される
 *  2. 非公開でも管理者はプレビューできる (開発中の動作確認のため)
 *  3. 保存されていないゲームは「公開」として扱う
 *     (新しいゲームを追加したとき、設定を保存し直すまで消える事故を防ぐ)
 *  4. 未知のキー / 壊れた値が保存されていても全体が既定値に巻き戻らない
 *  5. スキーマに .default() が付いていない (部分更新バグ対策)
 */
import {
  GAME_KEYS,
  GAME_VISIBILITY_ITEMS,
  GAME_VISIBILITY_KEY,
  GameVisibilityMapSchema,
  DEFAULT_GAME_VISIBILITY,
  normalizeGameVisibility,
  isGameKey,
  isGamePubliclyVisible,
  canViewGame,
  isGamePreview,
  hasAnyPubliclyVisibleGame,
  type GameVisibilityMap,
} from './game-visibility';

const ALL_ON: GameVisibilityMap = { acchi: true, slot: true, story: true };

describe('定義', () => {
  it('AppSetting のキーは game.visibility', () => {
    expect(GAME_VISIBILITY_KEY).toBe('game.visibility');
  });

  it('既定値はすべて公開 (既存サイトが勝手に非公開にならない)', () => {
    for (const key of GAME_KEYS) {
      expect(DEFAULT_GAME_VISIBILITY[key]).toBe(true);
    }
  });

  it('GAME_VISIBILITY_ITEMS は全ゲームを過不足なく網羅する', () => {
    expect(GAME_VISIBILITY_ITEMS.map((i) => i.key).sort()).toEqual([...GAME_KEYS].sort());
    expect(new Set(GAME_VISIBILITY_ITEMS.map((i) => i.key)).size).toBe(GAME_KEYS.length);
  });

  it('isGameKey は既知のキーだけ true', () => {
    expect(isGameKey('acchi')).toBe(true);
    expect(isGameKey('slot')).toBe(true);
    expect(isGameKey('story')).toBe(true);
    expect(isGameKey('unknown')).toBe(false);
    expect(isGameKey(undefined)).toBe(false);
    expect(isGameKey(1)).toBe(false);
  });
});

describe('GameVisibilityMapSchema', () => {
  it('真偽値のマップを受け付ける', () => {
    expect(GameVisibilityMapSchema.parse({ acchi: false, slot: true })).toEqual({
      acchi: false,
      slot: true,
    });
  });

  it('真偽値でない値ははじく', () => {
    expect(GameVisibilityMapSchema.safeParse({ acchi: 'false' }).success).toBe(false);
  });

  it('空オブジェクトを受け付ける (部分更新で 1 キーだけ送るため)', () => {
    expect(GameVisibilityMapSchema.parse({})).toEqual({});
  });

  it('【部分更新バグ対策】parse で送られなかったキーが勝手に埋まらない', () => {
    // .default() を付けてしまうと、PATCH で 1 キーだけ送ったときに
    // 他のキーも既定値 (公開) で埋められ「1つ隠すと他が戻る」不具合になる。
    const patch = GameVisibilityMapSchema.parse({ slot: false });
    expect(Object.keys(patch)).toEqual(['slot']);
    expect(patch).not.toHaveProperty('acchi');
    expect(patch).not.toHaveProperty('story');
  });
});

describe('normalizeGameVisibility', () => {
  it('保存済みの値を反映する', () => {
    expect(normalizeGameVisibility({ acchi: false, slot: true, story: false })).toEqual({
      acchi: false,
      slot: true,
      story: false,
    });
  });

  it('保存されていないゲームは公開扱い (新規追加ゲームが消えない)', () => {
    expect(normalizeGameVisibility({ acchi: false })).toEqual({
      acchi: false,
      slot: true,
      story: true,
    });
  });

  it('未知のキーは無視し、既知のキーの設定は保つ', () => {
    const result = normalizeGameVisibility({ slot: false, removedGame: false });
    expect(result).toEqual({ acchi: true, slot: false, story: true });
    expect(result).not.toHaveProperty('removedGame');
  });

  it('真偽値でない値は既定値 (公開) 扱いにし、全体を巻き戻さない', () => {
    expect(normalizeGameVisibility({ acchi: 'no', slot: false })).toEqual({
      acchi: true,
      slot: false,
      story: true,
    });
  });

  it('null / undefined / 配列 / 文字列は既定値', () => {
    for (const bad of [null, undefined, [], 'x', 1]) {
      expect(normalizeGameVisibility(bad)).toEqual(DEFAULT_GAME_VISIBILITY);
    }
  });

  it('戻り値は既定値オブジェクトを共有しない (呼び出し側の変更で汚染されない)', () => {
    const a = normalizeGameVisibility({});
    a.slot = false;
    expect(DEFAULT_GAME_VISIBILITY.slot).toBe(true);
    expect(normalizeGameVisibility({}).slot).toBe(true);
  });
});

describe('isGamePubliclyVisible (マスター AND 個別)', () => {
  it('マスター ON + 個別 ON なら公開', () => {
    expect(isGamePubliclyVisible(true, ALL_ON, 'slot')).toBe(true);
  });

  it('マスター ON + 個別 OFF なら非公開 (そのゲームだけ隠れる)', () => {
    expect(isGamePubliclyVisible(true, { ...ALL_ON, slot: false }, 'slot')).toBe(false);
    // 他のゲームは影響を受けない
    expect(isGamePubliclyVisible(true, { ...ALL_ON, slot: false }, 'acchi')).toBe(true);
  });

  it('マスター OFF なら個別 ON でも非公開 (緊急停止スイッチとして機能する)', () => {
    expect(isGamePubliclyVisible(false, ALL_ON, 'acchi')).toBe(false);
    expect(isGamePubliclyVisible(false, ALL_ON, 'slot')).toBe(false);
    expect(isGamePubliclyVisible(false, ALL_ON, 'story')).toBe(false);
  });
});

describe('canViewGame / isGamePreview (管理者プレビュー)', () => {
  it('公開中は未ログインでも閲覧でき、プレビュー扱いにはならない', () => {
    expect(canViewGame(true, undefined)).toBe(true);
    expect(isGamePreview(true, undefined)).toBe(false);
  });

  it('非公開中の一般会員 / 未ログインは閲覧できない', () => {
    expect(canViewGame(false, 'USER')).toBe(false);
    expect(canViewGame(false, undefined)).toBe(false);
    expect(canViewGame(false, null)).toBe(false);
  });

  it('非公開中でも ADMIN / STAFF / SUPER_ADMIN はプレビューできる', () => {
    for (const role of ['ADMIN', 'STAFF', 'SUPER_ADMIN'] as const) {
      expect(canViewGame(false, role)).toBe(true);
      expect(isGamePreview(false, role)).toBe(true);
    }
  });

  it('公開中の管理者はプレビュー扱いにならない (バナーを出さない)', () => {
    expect(isGamePreview(true, 'ADMIN')).toBe(false);
  });
});

describe('hasAnyPubliclyVisibleGame', () => {
  it('1 本でも公開されていれば true', () => {
    expect(hasAnyPubliclyVisibleGame(true, { acchi: false, slot: true, story: false })).toBe(
      true,
    );
  });

  it('全ゲーム個別 OFF なら false (ナビからゲームを隠せる)', () => {
    expect(
      hasAnyPubliclyVisibleGame(true, { acchi: false, slot: false, story: false }),
    ).toBe(false);
  });

  it('マスター OFF なら false', () => {
    expect(hasAnyPubliclyVisibleGame(false, ALL_ON)).toBe(false);
  });
});
