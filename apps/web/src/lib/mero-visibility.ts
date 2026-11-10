/**
 * Mero (Pui の上位ポイント) の公開 / 非公開ゲート。
 *
 * MyRoom (lib/myroom-visibility.ts) と同じ方式:
 *   一般会員 / 未ログイン … 非表示 (ページ・API とも 404)
 *   管理者 (ADMIN 以上)  … プレビュー表示 (画面に「非公開中」バナー)
 *
 * 判定そのものは @idol/shared の純粋関数 (canViewMeroSection / isMeroSectionPreview)。
 * ここでは AppSetting とセッションを読んで組み合わせるだけ。
 *
 * 【なぜ API も塞ぐのか】
 * ページだけ隠しても API が生きていれば、URL を直接叩いて残高や履歴を取得でき、
 * 公開前に Mero の存在が知られてしまう。404 にするのも «存在» を隠すため。
 */
import { canViewMeroSection, isMeroSectionPreview } from '@idol/shared';
import { auth } from '@/auth';
import { resolveApiSession } from '@/lib/api-auth';
import { errors } from '@/lib/errors';
import { getSiteSectionVisibility } from '@/lib/app-setting';

export type MeroVisibilityState = {
  /** 設定上 Mero が一般公開されているか */
  meroVisible: boolean;
  /** この閲覧者が Mero を閲覧できるか (公開中 or 管理者) */
  canView: boolean;
  /** 管理者プレビュー中か (非公開だが管理者なので見えている) */
  isPreview: boolean;
};

function toState(meroVisible: boolean, role: Parameters<typeof canViewMeroSection>[1]) {
  return {
    meroVisible,
    canView: canViewMeroSection(meroVisible, role),
    isPreview: isMeroSectionPreview(meroVisible, role),
  };
}

/** Server Component 用 (Cookie セッション) */
export async function resolveMeroVisibility(): Promise<MeroVisibilityState> {
  const [{ meroVisible }, session] = await Promise.all([getSiteSectionVisibility(), auth()]);
  return toState(meroVisible, session?.user?.role);
}

/** API Route 用 (Bearer トークン / Cookie どちらでも) */
export async function resolveMeroVisibilityForApi(req: Request): Promise<MeroVisibilityState> {
  const [{ meroVisible }, session] = await Promise.all([
    getSiteSectionVisibility(),
    resolveApiSession(req),
  ]);
  return toState(meroVisible, session?.user?.role);
}

/** API Route 用ガード。閲覧できなければ 404 を投げる */
export async function requireMeroVisible(req: Request): Promise<MeroVisibilityState> {
  const state = await resolveMeroVisibilityForApi(req);
  if (!state.canView) throw errors.notFound();
  return state;
}
