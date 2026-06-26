import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import { resolvePreferredName } from '@idol/shared';
import { auth } from '@/auth';
import { listMyDirectMessages, getNgWords } from '@/lib/dm';
import { DmClient } from './dm-client';

export const metadata: Metadata = { title: 'REIRIE への DM' };
export const dynamic = 'force-dynamic';

export default async function DmPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/signin?callbackUrl=/me/dm');
  }

  const [user, messages, ngWords] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferredName: true, displayName: true },
    }),
    listMyDirectMessages(session.user.id),
    getNgWords(),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <DmClient
        initial={{
          preferredName: user?.preferredName ?? '',
          resolvedName: resolvePreferredName(user?.preferredName, user?.displayName),
          ngWords,
          messages: messages.map((m) => ({
            id: m.id,
            body: m.body,
            senderName: m.senderName,
            status: m.status,
            createdAt: m.createdAt.toISOString(),
          })),
        }}
      />
    </div>
  );
}
