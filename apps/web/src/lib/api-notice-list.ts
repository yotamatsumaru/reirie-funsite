/**
 * お知らせ一覧の「この閲覧者に見せてよいものだけ残す」絞り込み。
 *
 * ## なぜ純粋関数として切り出すのか
 *
 * 同じ絞り込みが 2 か所で必要になる。
 *
 *   - Web  … /notices (Server Component)
 *   - API  … GET /api/notices (ネイティブアプリ向け)
 *
 * 両方に同じ条件を手書きすると、配信対象 (audience) を増やしたときに
 * 片方だけ直し忘れる。そのとき起きるのは
 * 「Web には出ないのにアプリには出る」= **限定お知らせの漏洩** なので、
 * 静かに壊れて気付きにくいうえ影響が大きい。
 *
 * 判定そのものは既存の `announcement-audience.ts` に集約されているため、
 * ここはその組み合わせ方 (ログイン判定とプラン判定の順序) だけを固定する。
 *
 * ## 詳細ページ側との役割分担
 *
 * 1 件の可否判定には `announcement-visibility.ts` の
 * `resolveAnnouncementVisibility` がある。あちらは
 * 「404 / ログインへ誘導 / アップグレード案内 / 下書きプレビュー」を
 * 区別して返すもので、詳細ページと詳細 API が使う。
 *
 * 一覧では区別が不要 (見せる or 出さない の 2 択) なので、
 * ここでは真偽値だけを扱う。
 */
import type { PlanTypeLiteral } from '@idol/shared';
import {
  planSatisfiesAudience,
  requiresSignIn,
  type AnnouncementAudienceLiteral,
} from './announcement-audience';

/** 絞り込みに必要なお知らせの属性だけ (DB モデルに依存させない) */
export type NoticeListItem = {
  status: string;
  audience: AnnouncementAudienceLiteral;
};

/** 絞り込みに必要な閲覧者の属性 */
export type NoticeViewer = {
  isLoggedIn: boolean;
  plan: PlanTypeLiteral | undefined | null;
};

/**
 * この閲覧者に 1 件を見せてよいか。
 *
 * 下書き (DRAFT) は一覧には絶対に出さない。
 * 運営のプレビューは詳細ページ側 (`?preview=1`) の役割で、
 * 一覧に混ぜると「公開したつもりのものと下書きが区別できない」状態になる。
 */
export function isNoticeVisibleInList(
  notice: NoticeListItem,
  viewer: NoticeViewer,
): boolean {
  if (notice.status !== 'PUBLISHED') return false;
  if (requiresSignIn(notice.audience) && !viewer.isLoggedIn) return false;
  return planSatisfiesAudience(notice.audience, viewer.plan);
}

/**
 * 一覧を閲覧可能なものだけに絞る。
 *
 * 並び順は入力のまま変えない (呼び出し側が新しい順で渡す)。
 */
export function filterVisibleNotices<T extends NoticeListItem>(
  notices: T[],
  viewer: NoticeViewer,
): T[] {
  return notices.filter((n) => isNoticeVisibleInList(n, viewer));
}

/**
 * 「非表示になっている件数」。
 *
 * Web の /notices が「🔒 会員限定のお知らせが N 件非表示です」と
 * 案内しているのと同じ数字。アプリでも同じ案内を出せるように
 * API のレスポンスに含める。
 *
 * 件数だけを返し、タイトルや本文は一切返さないのが要点。
 * 「何件あるか」は加入判断の材料になるが、
 * 中身が漏れると限定公開の意味が無くなる。
 */
export function countHiddenNotices(
  notices: NoticeListItem[],
  viewer: NoticeViewer,
): number {
  const published = notices.filter((n) => n.status === 'PUBLISHED');
  const visible = published.filter((n) => isNoticeVisibleInList(n, viewer));
  return published.length - visible.length;
}
