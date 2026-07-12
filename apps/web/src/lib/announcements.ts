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

function sortByCreatedAtDesc(rows: Announcement[]): Announcement[] {
  return [...rows].sort(
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
  return prisma.announcement.findUnique({ where: { id } });
}
