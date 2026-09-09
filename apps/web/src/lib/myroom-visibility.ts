/**
 * MyRoom (2次元の ReiRieRoom) の公開 / 非公開ゲート。
 *
 * 【背景】
 * MyRoom は 3 段階に分けて開発中の機能で、まだ会員に見せられる状態ではない。
 * 「非表示にして管理者だけ見られるように」という運営方針に合わせ、
 * ゲームと同じ «非公開でも管理者はプレビューできる» 方式で実装する。
 *
 *   一般会員 / 未ログイン … 404 (存在ごと隠す)
 *   管理者 (ADMIN 以上)  … プレビュー表示 (画面に「非公開中」バナー)
 *
 * 判定そのものは純粋関数として @idol/shared に既にあり
 * (canViewMyRoomSection / isMyRoomSectionPreview)、ここでは
 * AppSetting とセッションを読んで組み合わせるだけにしている。
 * サーバー / クライアントどちらから見ても同じ結果になるようにするため。
 *
 * 【なぜ 403 ではなく 404 なのか】
 * 403 は「そこに何かがある」ことを教えてしまう。開発中の機能の存在自体を
 * 知らせない方が、公開前に話題が漏れるのを防げる。
 * ゲーム (game-visibility.ts) と同じ判断に揃えている。
 *
 * 【なぜ管理者だけ通すのか】
 * 非公開の期間が長く続くため、その間ずっと運営自身も触れないと
 * 公開直前まで一度も動作確認できないことになる。
 */
import {
  canViewMyRoomSection,
  isMyRoomSectionPreview,
} from '@idol/shared';
import { auth } from '@/auth';
import { resolveApiSession } from '@/lib/api-auth';
import { errors } from '@/lib/errors';
import { getSiteSectionVisibility } from '@/lib/app-setting';

/** ゲートの判定結果 */
export type MyRoomVisibilityState = {
  /** 設定上 MyRoom が一般公開されているか */
  myRoomVisible: boolean;
  /** この閲覧者が MyRoom を閲覧できるか (公開中 or 管理者) */
  canView: boolean;
  /** 管理者プレビュー中か (非公開だが管理者なので見えている) */
  isPreview: boolean;
};

/**
 * Server Component 用。Cookie セッションからロールを解決してゲート状態を返す。
 *
 * 使い方:
 *   const { canView, isPreview } = await resolveMyRoomVisibility();
 *   if (!canView) notFound();
 */
export async function resolveMyRoomVisibility(): Promise<MyRoomVisibilityState> {
  const [{ myRoomVisible }, session] = await Promise.all([
    getSiteSectionVisibility(),
    auth(),
  ]);
  const role = session?.user?.role;

  return {
    myRoomVisible,
    canView: canViewMyRoomSection(myRoomVisible, role),
    isPreview: isMyRoomSectionPreview(myRoomVisible, role),
  };
}

/**
 * API Route 用。Bearer トークン / Cookie のどちらでもロールを解決する。
 *
 * 【なぜ API でも判定するのか / 重要】
 * ページだけ隠しても API が生きていれば、URL を直接叩いて
 * 家具カタログや部屋データを取得できてしまう。
 * 「非表示」を名乗るなら API も塞がなければ意味がない。
 */
export async function resolveMyRoomVisibilityForApi(
  req: Request,
): Promise<MyRoomVisibilityState> {
  const [{ myRoomVisible }, session] = await Promise.all([
    getSiteSectionVisibility(),
    resolveApiSession(req),
  ]);
  const role = session?.user?.role;

  return {
    myRoomVisible,
    canView: canViewMyRoomSection(myRoomVisible, role),
    isPreview: isMyRoomSectionPreview(myRoomVisible, role),
  };
}

/**
 * API Route 用のガード。閲覧できない場合は 404 を投げる。
 *
 * 403 ではなく 404 にするのは、開発中の機能の «存在» を隠すため
 * (このファイル冒頭のコメント参照)。
 *
 * @returns 判定結果 (プレビュー中かどうかをレスポンスに含めたい場合に使う)
 */
export async function requireMyRoomVisible(
  req: Request,
): Promise<MyRoomVisibilityState> {
  const state = await resolveMyRoomVisibilityForApi(req);
  if (!state.canView) {
    throw errors.notFound();
  }
  return state;
}
