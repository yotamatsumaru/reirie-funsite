/**
 * ゲーム「個別」の公開 / 非公開設定。
 *
 * 【背景 / site.sectionVisibility との役割分担】
 * これまではゲーム全体を一括で出し入れする `gamesVisible`
 * (site.sectionVisibility) しか無かったため、「スロットだけ先に公開して
 * あっちむいてPUIは開発中のまま隠す」ということができなかった。
 * そこでゲーム 1 本ごとのフラグをこのファイルで定義する。
 *
 *   site.sectionVisibility.gamesVisible … ゲーム機能そのもののマスタースイッチ
 *   game.visibility[<gameKey>]          … ゲーム 1 本ごとのスイッチ
 *
 * 実際に一般公開されるのは「マスターが ON かつ そのゲームが ON」のときだけ
 * (AND 条件)。マスターを OFF にすれば個別設定に関わらず全ゲームが隠れるので、
 * 緊急停止用のスイッチとして今まで通り使える。
 *
 * 【管理者プレビュー】
 * ゲームは「非公開の間こそ運営が触って動作確認したい」ため、OFF でも
 * 管理者 (ADMIN 以上) は引き続きプレイできる。この方針は個別フラグでも同じ。
 *   - 一般会員 / 未ログイン … 404
 *   - 管理者 (ADMIN 以上)   … プレビュー表示 (「非公開中」バナー)
 *
 * 判定ロジックは純粋関数としてここに置き、サーバー / クライアントどちらから
 * 呼んでも同じ結果になるようにしている。
 */
import { z } from 'zod';
import { isAdmin, type UserRoleLiteral } from './constants';

/** AppSetting に保存する設定キー */
export const GAME_VISIBILITY_KEY = 'game.visibility';

/**
 * 公開 / 非公開を個別に切り替えられるゲームの識別子。
 *
 * - 'acchi' / 'slot' はミニゲーム (/me/games/<key>)。
 * - 'story' は恋愛 ADV 全体 (/game/[characterSlug], /game/play/[scenarioId] と
 *   /api/game/* 一式)。キャラクター単位の公開は既存の GameCharacter.status
 *   (PUBLISHED / DRAFT) で行うため、ここでは「恋愛 ADV というゲーム 1 本」として扱う。
 *
 * 【ゲームを追加するとき】この配列にキーを足し、GAME_VISIBILITY_ITEMS に
 * 表示情報を足すだけで、管理画面のトグルと各ゲートに自動で反映される。
 */
export const GAME_KEYS = ['acchi', 'slot', 'story'] as const;

export type GameKey = (typeof GAME_KEYS)[number];

/** 管理画面のトグル一覧に出す表示情報 */
export const GAME_VISIBILITY_ITEMS: {
  key: GameKey;
  label: string;
  emoji: string;
  description: string;
}[] = [
  {
    key: 'acchi',
    label: 'あっちむいてPUI',
    emoji: '👉',
    description: 'ミニゲーム (/me/games/acchi)。勝つと Pui がもらえます。',
  },
  {
    key: 'slot',
    label: 'スロット',
    emoji: '🎰',
    description: 'ミニゲーム (/me/games/slot)。絵柄を揃えると Pui がもらえます。',
  },
  {
    key: 'story',
    label: '恋愛 ADV ストーリー',
    emoji: '💗',
    description:
      'キャラ詳細・シナリオ再生 (/game/<キャラ>, /game/play/<章>)。キャラ単位の公開は各キャラの公開状態で管理します。',
  },
];

/**
 * 保存形式のスキーマ。
 *
 * 【重要 / 部分更新バグ対策】ここでも `.default()` は使わない。
 * site-section-visibility と同じく PATCH は「変更されたキーだけ」を受け取り
 * サーバー側で保存済みの値にマージする設計のため、default があると
 * 「1つを非公開にすると他が公開に戻る」不具合になる。
 * 既定値は DEFAULT_GAME_VISIBILITY / normalizeGameVisibility で一元管理する。
 *
 * 【なぜ z.enum ではなく z.string をキーにするか】
 * 将来ゲームを削除したときに、DB に残った古いキーで safeParse が落ちて
 * 「全ゲームが既定値に戻る」事故を避けるため。未知のキーは
 * normalizeGameVisibility で捨てる。
 */
export const GameVisibilityMapSchema = z.record(z.string(), z.boolean());

/** 全ゲーム分の公開設定 (正規化済み) */
export type GameVisibilityMap = Record<GameKey, boolean>;

/**
 * 未設定時の既定値。
 * 既存サイトでは全ゲームが既に公開済みのため、既定は「すべて公開」。
 * (未設定の本番 DB に対して「勝手に非公開になる」事故を防ぐ)
 */
export const DEFAULT_GAME_VISIBILITY: GameVisibilityMap = {
  acchi: true,
  slot: true,
  story: true,
};

/** 文字列が既知のゲームキーか */
export function isGameKey(value: unknown): value is GameKey {
  return typeof value === 'string' && (GAME_KEYS as readonly string[]).includes(value);
}

/**
 * DB から読んだ生の値を、全ゲーム分そろった設定に正規化する。
 *
 *  - 未知のキー           … 無視する (削除済みゲームの残骸)
 *  - 保存されていないキー … true (公開) 扱い。新しく追加したゲームが
 *                            「保存し直すまで消える」事故を防ぐ
 *  - 壊れた値 / null      … すべて既定値 (公開)
 */
export function normalizeGameVisibility(raw: unknown): GameVisibilityMap {
  const result: GameVisibilityMap = { ...DEFAULT_GAME_VISIBILITY };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // 未知のキーは捨てる。真偽値でない値も無視して既定値 (公開) を維持する。
    if (isGameKey(key) && typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * そのゲームが一般公開されているか (マスタースイッチとの AND)。
 *
 * @param gamesVisible ゲーム機能全体のマスタースイッチ (site.sectionVisibility)
 * @param map          ゲーム個別の公開設定
 * @param game         判定したいゲーム
 */
export function isGamePubliclyVisible(
  gamesVisible: boolean,
  map: GameVisibilityMap,
  game: GameKey,
): boolean {
  return gamesVisible && map[game] !== false;
}

/**
 * そのゲームをこの閲覧者が閲覧できるか。
 * 非公開でも管理者 (ADMIN 以上) はプレビューとして閲覧できる。
 */
export function canViewGame(
  publiclyVisible: boolean,
  role: UserRoleLiteral | undefined | null,
): boolean {
  return publiclyVisible || isAdmin(role);
}

/**
 * そのゲームを「管理者プレビューとして」表示しているか。
 * true のときは画面上に「非公開中」の警告バナー / バッジを出し、
 * 運営が公開したつもりで非公開のまま放置する事故を防ぐ。
 */
export function isGamePreview(
  publiclyVisible: boolean,
  role: UserRoleLiteral | undefined | null,
): boolean {
  return !publiclyVisible && isAdmin(role);
}

/**
 * 一般公開されているゲームが 1 本でもあるか。
 * マスターが OFF なら (個別設定に関わらず) false。
 */
export function hasAnyPubliclyVisibleGame(
  gamesVisible: boolean,
  map: GameVisibilityMap,
): boolean {
  return gamesVisible && GAME_KEYS.some((k) => map[k] !== false);
}
