/**
 * ゲームの公開 / 非公開ゲート。
 *
 * 【背景】
 * 今後もゲームを開発していくため、「開発中は一般会員に見せず、完成したら公開する」を
 * 管理画面のトグルだけで切り替えられるようにする。
 *
 * 【2 段構えの設定】
 *   1. マスタースイッチ … AppSetting `site.sectionVisibility` の `gamesVisible`。
 *      ゲーム機能そのものを一括で出し入れする (他セクションと同じ扱い)。
 *   2. ゲーム個別       … AppSetting `game.visibility` の `<gameKey>`。
 *      「スロットだけ先に公開して、あっちむいてPUIは開発中のまま隠す」ができる。
 *
 * 実際に一般公開されるのは「マスター ON かつ そのゲーム ON」のとき (AND)。
 * マスターを OFF にすれば個別設定に関わらず全ゲームが隠れるため、今まで通り
 * 緊急停止スイッチとして使える。
 *
 * 【他セクションとの唯一の違い: 管理者プレビュー】
 * コンテンツ / グッズ / DM は「非公開 = 全員 404」で問題ないが、ゲームは非公開の間こそ
 * 運営が実際に触って動作確認する必要がある。管理者まで 404 にすると公開するまで一切
 * テストできないため、OFF の間は
 *   - 一般会員 / 未ログイン … 404
 *   - 管理者 (ADMIN 以上)   … プレビュー表示 (画面に「非公開中」バナー)
 * とする。判定ロジック自体は純粋関数として @idol/shared に置き、サーバー / クライアント
 * どちらからも同じ結果になるようにしている (canViewGame / isGamePreview)。
 */
import {
  GAME_KEYS,
  canViewGameSection,
  isGameSectionPreview,
  canViewGame,
  isGamePreview,
  isGamePubliclyVisible,
  hasAnyPubliclyVisibleGame,
  type GameKey,
  type GameVisibilityMap,
} from '@idol/shared';
import { auth } from '@/auth';
import { resolveApiSession } from '@/lib/api-auth';
import { errors } from '@/lib/errors';
import { getSiteSectionVisibility, getGameVisibility } from '@/lib/app-setting';

/** ゲートの判定結果 */
export type GameVisibilityState = {
  /** 設定上ゲームが一般公開されているか */
  gamesVisible: boolean;
  /** この閲覧者がゲームを閲覧できるか (公開中 or 管理者) */
  canView: boolean;
  /** 管理者プレビュー中か (非公開だが管理者なので見えている) */
  isPreview: boolean;
};

/**
 * ゲーム 1 本ぶんの判定結果。
 * セクション全体 (GameVisibilityState) と同じ形に加え、その 1 本が
 * 一般公開されているか (publiclyVisible) を持つ。
 */
export type SingleGameVisibilityState = GameVisibilityState & {
  /** 判定対象のゲーム */
  game: GameKey;
  /** マスター AND 個別の結果 = 一般会員から見えるか */
  publiclyVisible: boolean;
};

/**
 * Server Component 用。Cookie セッションからロールを解決してゲート状態を返す。
 *
 * 【引数 game を渡した場合】そのゲーム 1 本について判定する。
 * 【省略した場合】ゲーム機能全体 (マスタースイッチ) について判定する。
 *   ゲーム一覧 (/game) のように「1 本でも見られるなら開く」画面で使う。
 *
 * 使い方:
 *   const { canView, isPreview } = await resolveGameVisibility('slot');
 *   if (!canView) notFound();
 */
export async function resolveGameVisibility(): Promise<GameVisibilityState>;
export async function resolveGameVisibility(
  game: GameKey,
): Promise<SingleGameVisibilityState>;
export async function resolveGameVisibility(
  game?: GameKey,
): Promise<GameVisibilityState | SingleGameVisibilityState> {
  const [{ gamesVisible }, map, session] = await Promise.all([
    getSiteSectionVisibility(),
    getGameVisibility(),
    auth(),
  ]);
  const role = session?.user?.role;

  if (game) {
    const publiclyVisible = isGamePubliclyVisible(gamesVisible, map, game);
    return {
      game,
      gamesVisible,
      publiclyVisible,
      canView: canViewGame(publiclyVisible, role),
      isPreview: isGamePreview(publiclyVisible, role),
    };
  }

  // ゲーム機能全体の判定。個別フラグで全ゲームが OFF になっている場合も
  // 「一般会員には見せるものが無い」ので、セクションごと非公開として扱う。
  const anyVisible = hasAnyPubliclyVisibleGame(gamesVisible, map);
  return {
    gamesVisible,
    canView: canViewGameSection(anyVisible, role),
    isPreview: isGameSectionPreview(anyVisible, role),
  };
}

/**
 * Server Component 用。全ゲームぶんの公開状態をまとめて返す。
 * ゲーム一覧 (/game) で「公開中のゲームだけ並べる / 管理者には非公開バッジ付きで
 * 全部並べる」ために使う。
 */
export async function resolveAllGameVisibility(): Promise<{
  gamesVisible: boolean;
  /** ゲームごとの「一般公開されているか」 */
  publiclyVisible: Record<GameKey, boolean>;
  /** ゲームごとの「この閲覧者が見られるか」 */
  canView: Record<GameKey, boolean>;
  /** セクション全体を開けるか (1 本でも見られるか) */
  canViewSection: boolean;
  /** セクション全体が管理者プレビュー状態か */
  isPreview: boolean;
}> {
  const [{ gamesVisible }, map, session] = await Promise.all([
    getSiteSectionVisibility(),
    getGameVisibility(),
    auth(),
  ]);
  const role = session?.user?.role;

  const publiclyVisible = {} as Record<GameKey, boolean>;
  const canView = {} as Record<GameKey, boolean>;
  for (const key of GAME_KEYS) {
    const pv = isGamePubliclyVisible(gamesVisible, map, key);
    publiclyVisible[key] = pv;
    canView[key] = canViewGame(pv, role);
  }

  const anyVisible = hasAnyPubliclyVisibleGame(gamesVisible, map);
  return {
    gamesVisible,
    publiclyVisible,
    canView,
    canViewSection: canViewGameSection(anyVisible, role),
    isPreview: isGameSectionPreview(anyVisible, role),
  };
}

/**
 * API Route 用。Cookie / Bearer どちらの認証でもロールを解決してゲート状態を返す。
 *
 * ※ Unity 等のネイティブクライアントは Bearer トークンで叩いてくるため、
 *   `auth()` (Cookie 前提) ではなく `resolveApiSession` を使う必要がある。
 *
 * @param game 判定対象のゲーム。省略時はゲーム機能全体で判定する。
 */
export async function resolveGameVisibilityForApi(
  req: Request,
  game?: GameKey,
): Promise<GameVisibilityState> {
  const [{ gamesVisible }, map] = await Promise.all([
    getSiteSectionVisibility(),
    getGameVisibility(),
  ]);
  const publiclyVisible = game
    ? isGamePubliclyVisible(gamesVisible, map, game)
    : hasAnyPubliclyVisibleGame(gamesVisible, map);

  // 公開中なら誰でも見られるので、セッション解決 (DB アクセス) を省略して高速化する。
  // (この fast path は個別フラグ導入後も維持する。公開中のゲームが大半のため)
  if (publiclyVisible) {
    return { gamesVisible, canView: true, isPreview: false };
  }

  const session = await resolveApiSession(req);
  const role = session?.user?.role;
  return {
    gamesVisible,
    canView: canViewGame(publiclyVisible, role),
    isPreview: isGamePreview(publiclyVisible, role),
  };
}

/**
 * API Route 用のガード。非公開かつ管理者でない場合に 404 を投げる。
 *
 * 【なぜ 403 ではなく 404 か】
 * 403 だと「機能は存在するが今は使えない」ことが分かってしまい、未公開のゲーム開発を
 * 外部から推測されうる。他セクション (/api/contents 等) も 404 で統一しているため、
 * ここでも 404 に揃える。
 *
 * @param game 判定対象のゲーム。省略時はゲーム機能全体で判定する。
 */
export async function requireGameSectionVisible(
  req: Request,
  game?: GameKey,
): Promise<void> {
  const { canView } = await resolveGameVisibilityForApi(req, game);
  if (!canView) {
    throw errors.notFound('ゲームは現在非公開です');
  }
}

/**
 * ゲーム 1 本ぶんの API ガード (requireGameSectionVisible の読みやすい別名)。
 * 呼び出し側で「どのゲームを守っているか」が明確になるよう、必須引数にしている。
 */
export async function requireGameVisible(req: Request, game: GameKey): Promise<void> {
  await requireGameSectionVisible(req, game);
}

export type { GameKey, GameVisibilityMap };
