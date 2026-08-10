/**
 * ゲームセクションの公開 / 非公開ゲート。
 *
 * 【背景】
 * 今後もゲームを開発していくため、「開発中は一般会員に見せず、完成したら公開する」を
 * 管理画面のトグルだけで切り替えられるようにする。設定は他セクション (コンテンツ /
 * グッズ / DM) と同じ AppSetting (site.sectionVisibility) の `gamesVisible` に保存する。
 *
 * 【他セクションとの唯一の違い: 管理者プレビュー】
 * コンテンツ / グッズ / DM は「非公開 = 全員 404」で問題ないが、ゲームは非公開の間こそ
 * 運営が実際に触って動作確認する必要がある。管理者まで 404 にすると公開するまで一切
 * テストできないため、OFF の間は
 *   - 一般会員 / 未ログイン … 404
 *   - 管理者 (ADMIN 以上)   … プレビュー表示 (画面に「非公開中」バナー)
 * とする。判定ロジック自体は純粋関数として @idol/shared に置き、サーバー / クライアント
 * どちらからも同じ結果になるようにしている (canViewGameSection / isGameSectionPreview)。
 */
import { canViewGameSection, isGameSectionPreview } from '@idol/shared';
import { auth } from '@/auth';
import { resolveApiSession } from '@/lib/api-auth';
import { errors } from '@/lib/errors';
import { getSiteSectionVisibility } from '@/lib/app-setting';

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
 * Server Component 用。Cookie セッションからロールを解決してゲート状態を返す。
 *
 * 使い方:
 *   const { canView, isPreview } = await resolveGameVisibility();
 *   if (!canView) notFound();
 */
export async function resolveGameVisibility(): Promise<GameVisibilityState> {
  const [{ gamesVisible }, session] = await Promise.all([
    getSiteSectionVisibility(),
    auth(),
  ]);
  const role = session?.user?.role;
  return {
    gamesVisible,
    canView: canViewGameSection(gamesVisible, role),
    isPreview: isGameSectionPreview(gamesVisible, role),
  };
}

/**
 * API Route 用。Cookie / Bearer どちらの認証でもロールを解決してゲート状態を返す。
 *
 * ※ Unity 等のネイティブクライアントは Bearer トークンで叩いてくるため、
 *   `auth()` (Cookie 前提) ではなく `resolveApiSession` を使う必要がある。
 */
export async function resolveGameVisibilityForApi(
  req: Request,
): Promise<GameVisibilityState> {
  const { gamesVisible } = await getSiteSectionVisibility();
  // 公開中なら誰でも見られるので、セッション解決 (DB アクセス) を省略して高速化する。
  if (gamesVisible) {
    return { gamesVisible: true, canView: true, isPreview: false };
  }
  const session = await resolveApiSession(req);
  const role = session?.user?.role;
  return {
    gamesVisible,
    canView: canViewGameSection(gamesVisible, role),
    isPreview: isGameSectionPreview(gamesVisible, role),
  };
}

/**
 * API Route 用のガード。非公開かつ管理者でない場合に 404 を投げる。
 *
 * 【なぜ 403 ではなく 404 か】
 * 403 だと「機能は存在するが今は使えない」ことが分かってしまい、未公開のゲーム開発を
 * 外部から推測されうる。他セクション (/api/contents 等) も 404 で統一しているため、
 * ここでも 404 に揃える。
 */
export async function requireGameSectionVisible(req: Request): Promise<void> {
  const { canView } = await resolveGameVisibilityForApi(req);
  if (!canView) {
    throw errors.notFound('ゲームは現在非公開です');
  }
}
