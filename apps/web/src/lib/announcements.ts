/**
 * お知らせ (Announcement) の読み取り専用ヘルパー
 *
 * Prisma モデル化済みのため、DB (本番) / demo-prisma (デモモード) の
 * どちらでも同じ呼び出しで動作する。
 *
 * demo-prisma スタブは orderBy をサポートしないため、
 * 並び順はここで JS 側にソートして本番/デモ間の挙動差を無くす。
 */
import { prisma } from '@idol/db';
import type { Announcement } from '@idol/db';

/**
 * 日付フィールドを必ず Date にそろえる。
 * 本番 (Prisma) は最初から Date だが、デモモードの模擬 DB は JSON 経由で
 * 文字列を返すため、そのままだと画面側の toISOString() / Intl.format で落ちる。
 */
function reviveDates(row: Announcement): Announcement {
  const toDate = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v as string));
  return {
    ...row,
    createdAt: toDate(row.createdAt) as Date,
    updatedAt: toDate(row.updatedAt) as Date,
    publishedAt: toDate(row.publishedAt),
    emailStartedAt: toDate(row.emailStartedAt),
    emailCompletedAt: toDate(row.emailCompletedAt),
  };
}

function sortByCreatedAtDesc(rows: Announcement[]): Announcement[] {
  return rows.map(reviveDates).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * 全お知らせ一覧を新しい順で取得する (super-admin 一覧 / トップページ用)。
 */
export async function listAnnouncements(): Promise<Announcement[]> {
  const rows = await prisma.announcement.findMany({});
  return sortByCreatedAtDesc(rows);
}

/**
 * 公開中 (PUBLISHED) のお知らせのみを新しい順で取得する (/notices 用)。
 */
export async function listPublishedAnnouncements(): Promise<Announcement[]> {
  const rows = await prisma.announcement.findMany({
    where: { status: 'PUBLISHED' },
  });
  return sortByCreatedAtDesc(rows);
}

/**
 * id 指定で1件取得する。存在しない場合は null。
 */
export async function getAnnouncement(id: string): Promise<Announcement | null> {
  const row = await prisma.announcement.findUnique({ where: { id } });
  return row ? reviveDates(row) : null;
}
