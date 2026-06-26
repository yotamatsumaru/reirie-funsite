/**
 * /super-admin/dm — REIRIE への DM 管理画面
 *  - ファンから届いた DM 一覧 (新着順) を表示・既読化
 *  - NG ワード一覧を編集 (部分一致でブロック)
 */
import type { Metadata } from 'next';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { getNgWords } from '@/lib/dm';
import { DmAdminClient } from './dm-admin-client';

export const metadata: Metadata = { title: 'DM 管理 | Super Admin' };
export const dynamic = 'force-dynamic';

export default async function SuperAdminDmPage() {
  await requireSuperAdmin();

  const [messages, ngWords, unreadCount] = await Promise.all([
    prisma.directMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        body: true,
        senderName: true,
        status: true,
        readAt: true,
        createdAt: true,
        user: { select: { id: true, displayName: true, memberNumber: true } },
      },
    }),
    getNgWords(),
    prisma.directMessage.count({ where: { status: 'SENT' } }),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <DmAdminClient
        initial={{
          ngWords,
          unreadCount,
          messages: messages.map((m) => ({
            id: m.id,
            body: m.body,
            senderName: m.senderName,
            status: m.status,
            createdAt: m.createdAt.toISOString(),
            user: {
              id: m.user.id,
              displayName: m.user.displayName,
              memberNumber: m.user.memberNumber,
            },
          })),
        }}
      />
    </div>
  );
}
