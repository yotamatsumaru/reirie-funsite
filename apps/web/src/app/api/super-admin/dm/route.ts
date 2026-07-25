/**
 * GET /api/super-admin/dm — ファンから REIRIE への DM 一覧 (新着順)
 *
 * SUPER_ADMIN 限定。運営が受信した DM を確認するためのエンドポイント。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  await requireSuperAdminView();

  const url = new URL(req.url);
  const status = url.searchParams.get('status'); // 'SENT' | 'READ' | 'REPLIED' | null
  const take = Math.min(Number(url.searchParams.get('take') ?? '100') || 100, 200);

  const messages = await prisma.directMessage.findMany({
    where:
      status === 'SENT' || status === 'READ' || status === 'REPLIED'
        ? { status }
        : undefined,
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      body: true,
      senderName: true,
      status: true,
      readAt: true,
      createdAt: true,
      user: {
        select: { id: true, displayName: true, memberNumber: true, email: true },
      },
    },
  });

  const unreadCount = await prisma.directMessage.count({ where: { status: 'SENT' } });

  return NextResponse.json({ messages, unreadCount });
});
