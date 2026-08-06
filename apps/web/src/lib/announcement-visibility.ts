/**
 * お知らせ (Announcement) の閲覧可否判定。
 *
 * 背景:
 *   下書き (DRAFT) のお知らせを「公開後と同じ見た目」で確認したい。
 *   ただし下書きは運営以外には絶対に見えてはいけない。
 *
 * 設計方針:
 *   判定ロジックを純粋関数として切り出し、ユニットテストで
 *   「誰に何が見えるか」を網羅的に固定する。
 *   ページ側 (Server Component) はこの関数の結果に従うだけにして、
 *   条件分岐が各所に散らばって片方だけ直し忘れる事故を防ぐ。
 *
 * ⚠️ プレビュー権限は **サーバー側のセッションのロール** だけで判定する。
 *    「秘密の URL を知っていれば見える」方式 (推測可能なトークン等) は
 *    採用しない。URL は履歴・リファラ・共有で漏れるため。
 */
import type { UserRoleLiteral, PlanTypeLiteral } from '@idol/shared';

/** 判定に必要なお知らせの属性だけを受け取る (DB モデルに依存させない) */
export type AnnouncementVisibilityInput = {
  status: 'DRAFT' | 'PUBLISHED';
  audience: 'ALL' | 'MEMBERS' | 'PREMIUM';
};

/** 判定に必要な閲覧者の属性 */
export type ViewerContext = {
  /** ログインしているか */
  isLoggedIn: boolean;
  role: UserRoleLiteral | undefined | null;
  plan: PlanTypeLiteral | undefined | null;
};

export type VisibilityDecision =
  /** 通常どおり表示してよい */
  | { kind: 'visible' }
  /**
   * 下書きを運営が確認している状態。
   * 表示はするが「これは下書きです」というバナーを必ず出す。
   */
  | { kind: 'preview' }
  /** 存在を隠す (404)。下書き・非公開はこれ。 */
  | { kind: 'not-found' }
  /** ログインが必要 (会員限定) */
  | { kind: 'signin-required' }
  /** PREMIUM プランが必要 */
  | { kind: 'upgrade-required' };

/**
 * お知らせの下書きをプレビューできるロールか。
 *
 * 管理画面 (/super-admin) を閲覧できる人と同じ範囲に揃える:
 *   - SUPER_ADMIN … 全操作可
 *   - STAFF       … 閲覧のみ可 (下書きの確認は「閲覧」なので許可)
 *
 * ADMIN (運営編集者) は /super-admin/announcements にアクセスできず
 * お知らせの作成者ではないため、プレビューも許可しない。
 */
export function canPreviewAnnouncements(
  role: UserRoleLiteral | undefined | null,
): boolean {
  return role === 'SUPER_ADMIN' || role === 'STAFF';
}

/**
 * お知らせ 1 件について、この閲覧者に何を見せるべきかを判定する。
 *
 * @param announcement 対象のお知らせ (status / audience)
 * @param viewer       閲覧者のセッション情報
 * @param previewRequested `?preview=1` が付いているか
 */
export function resolveAnnouncementVisibility(
  announcement: AnnouncementVisibilityInput,
  viewer: ViewerContext,
  previewRequested = false,
): VisibilityDecision {
  const canPreview = canPreviewAnnouncements(viewer.role);

  // --- 下書き ---------------------------------------------------------
  if (announcement.status !== 'PUBLISHED') {
    // 運営以外には「存在しない」ものとして扱う。
    // 403 ではなく 404 にするのは、下書きの ID の存在自体を
    // 漏らさないため (存在確認に使われるのを防ぐ)。
    if (!canPreview) return { kind: 'not-found' };

    // 運営でも、明示的に preview を要求していなければ 404 のまま。
    // (公開前の URL をうっかり共有したとき、共有した本人には
    //  見えて他人には見えない、という混乱を避ける)
    if (!previewRequested) return { kind: 'not-found' };

    // 運営がプレビューする場合は audience 制限を無視する。
    // 「PREMIUM 限定のお知らせを FREE プランの運営が確認できない」
    // という不便を避けるため。下書きの確認が目的なので問題ない。
    return { kind: 'preview' };
  }

  // --- 公開済み -------------------------------------------------------
  if (announcement.audience === 'MEMBERS' && !viewer.isLoggedIn) {
    return { kind: 'signin-required' };
  }

  if (announcement.audience === 'PREMIUM' && viewer.plan !== 'PREMIUM') {
    // 運営は公開済み PREMIUM 限定お知らせも確認できるようにする
    // (サポート対応で「会員に何が見えているか」を確認する必要がある)
    if (canPreview) return { kind: 'visible' };
    return { kind: 'upgrade-required' };
  }

  return { kind: 'visible' };
}
