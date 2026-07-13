import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { jstDateKey, remainingPlays, ACCHI_MAX_PLAYS_PER_DAY, ACCHI_WIN_REWARD, isPromoActive } from '@idol/shared';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { getAcchiPlayCountToday, PROMO_UNLIMITED_REMAINING } from '@/lib/points';
import { getAcchiVoiceUrlMap } from '@/lib/game-audio';
import { getCharacterImageUrlMap } from '@/lib/character-image';
import { AcchiGameClient } from './acchi-client';

export const metadata: Metadata = { title: 'あっちむいてPUI' };
export const dynamic = 'force-dynamic';

export default async function AcchiGamePage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/signin?callbackUrl=/me/games/acchi');
  }

  const [playedToday, user, voiceUrls, characterImageUrls] = await Promise.all([
    getAcchiPlayCountToday(session.user.id),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { points: true, promoUntil: true },
    }),
    getAcchiVoiceUrlMap(),
    getCharacterImageUrlMap(),
  ]);

  const promoActive = isPromoActive(user?.promoUntil ?? null);

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <AcchiGameClient
        initial={{
          date: jstDateKey(),
          maxPerDay: ACCHI_MAX_PLAYS_PER_DAY,
          winReward: ACCHI_WIN_REWARD,
          playedToday,
          remaining: promoActive
            ? PROMO_UNLIMITED_REMAINING
            : remainingPlays(playedToday),
          promoActive,
          balance: user?.points ?? 0,
        }}
        voiceUrls={voiceUrls}
        characterImageUrls={characterImageUrls}
      />
    </div>
  );
}
