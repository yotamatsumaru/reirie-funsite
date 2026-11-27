/**
 * GET /api/me/contact — 自分のお問い合わせ一覧 (最近やり取りがあった順)
 *
 * response: { threads: [...], unreadCount }
 *   unreadCount = まだ読んでいない運営からのメッセージ数 (バッジ用)
 */
import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';
import { countUnreadForMember, listMemberThreads } from '@/lib/contact-thread';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const [threads, unreadCount] = await Promise.all([
    listMemberThreads(session.user.id),
    countUnreadForMember(session.user.id),
  ]);
  return NextResponse.json(
    {
      threads: threads.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        lastMessageAt: t.lastMessageAt.toISOString(),
      })),
      unreadCount,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
