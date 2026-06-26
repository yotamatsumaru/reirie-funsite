import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { jstDateKey, remainingPlays, ACCHI_MAX_PLAYS_PER_DAY, ACCHI_WIN_REWARD } from '@idol/shared';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { getAcchiPlayCountToday } from '@/lib/points';
import { AcchiGameClient } from './acchi-client';

export const metadata: Metadata = { title: 'あっち向いてホイ' };
export const dynamic = 'force-dynamic';

export default async function AcchiGamePage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/signin?callbackUrl=/me/games/acchi');
  }

  const [playedToday, user] = await Promise.all([
    getAcchiPlayCountToday(session.user.id),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { points: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <AcchiGameClient
        initial={{
          date: jstDateKey(),
          maxPerDay: ACCHI_MAX_PLAYS_PER_DAY,
          winReward: ACCHI_WIN_REWARD,
          playedToday,
          remaining: remainingPlays(playedToday),
          balance: user?.points ?? 0,
        }}
      />
    </div>
  );
}
