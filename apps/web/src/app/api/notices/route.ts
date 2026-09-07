/**
 * GET /api/notices — 公開中のお知らせ一覧
 *
 * Web の /notices と同じものを REST API 化したもの。
 *
 * ## ログイン必須にしない理由
 *
 * audience=ALL のお知らせは未ログインでも読める (Web も同じ) ため、
 * `requireApiSession` ではなく `resolveApiSession` を使う。
 * ここで 401 にすると、アプリの起動直後 (未ログイン状態) に
 * 公開お知らせすら表示できなくなる。
 *
 * ## 絞り込みを共通関数に寄せている理由
 *
 * 可否判定を Web とこの API で二重に手書きすると、
 * 配信対象 (audience) を増やしたときに片方だけ直し忘れる。
 * そのとき起きるのは「Web には出ないのにアプリには出る」=
 * 限定お知らせの漏洩なので、静かに壊れるうえ影響が大きい。
 * 判定は lib/api-notice-list.ts に集約している。
 *
 * ## 本文 (body) を一覧でも返す
 *
 * Web の一覧は本文を 2 行に省略して抜粋表示している。
 * 抜粋をサーバー側で切るとアプリの表示行数に合わなくなるため、
 * 本文はそのまま返し、省略はクライアントに任せる。
 * 閲覧可否のフィルタは通しているので、
 * 見せてよい相手にしか届かない。
 *
 * response:
 *   { notices: [{ id, title, body, audience, publishedAt }], hiddenCount }
 */
import { NextResponse } from 'next/server';
import { listAnnouncements } from '@/lib/announcements';
import { resolveApiSession } from '@/lib/api-auth';
import { countHiddenNotices, filterVisibleNotices } from '@/lib/api-notice-list';
import { handle } from '@/lib/errors';
import type { AnnouncementAudienceLiteral } from '@/lib/announcement-audience';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  /**
   * 未ログインでも 401 にしない。
   * catch は付けない (resolveApiSession は未認証時に null を返す仕様で、
   * 例外を握り潰すと «トークンが壊れている» を無言で無視してしまう)。
   */
  const session = await resolveApiSession(req);

  const viewer = {
    isLoggedIn: !!session?.user?.id,
    plan: session?.user?.plan,
  };

  // listAnnouncements は新しい順 (createdAt desc) で返す。
  const all = (await listAnnouncements()).map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    audience: a.audience as AnnouncementAudienceLiteral,
    publishedAt: a.publishedAt,
    status: a.status as string,
  }));

  const visible = filterVisibleNotices(all, viewer);

  return NextResponse.json({
    notices: visible.map(({ status: _status, ...notice }) => notice),
    /**
     * 「会員限定のお知らせが N 件非表示」の案内用。
     * Web の /notices が同じ数字を出している。
     * 件数だけを返し、タイトルや本文は一切含めない。
     */
    hiddenCount: countHiddenNotices(all, viewer),
  });
});
