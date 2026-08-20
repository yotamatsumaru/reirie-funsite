import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { jstDateKey, remainingPlays, ACCHI_MAX_PLAYS_PER_DAY, ACCHI_WIN_REWARD, isPromoActive } from '@idol/shared';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { getAcchiPlayCountToday, PROMO_UNLIMITED_REMAINING, safeGetPromoUntil } from '@/lib/points';
import { getAcchiVoiceUrlMap } from '@/lib/game-audio';
import { getCharacterImageUrlMap } from '@/lib/character-image';
import { resolveGameVisibility } from '@/lib/game-visibility';
import { GamePreviewBanner } from '@/components/game/GamePreviewBanner';
import { AcchiGameClient } from './acchi-client';

export const metadata: Metadata = { title: 'あっちむいてPUI' };
export const dynamic = 'force-dynamic';

export default async function AcchiGamePage() {
  // 非公開中は一般会員には 404。管理者だけはプレビューとしてプレイできる。
  const { canView, isPreview } = await resolveGameVisibility('acchi');
  if (!canView) notFound();

  const session = await auth();
  if (!session?.user) {
    redirect('/signin?callbackUrl=/me/games/acchi');
  }

  const [playedToday, user, voiceUrls, characterImageUrls, promoUntil] = await Promise.all([
    getAcchiPlayCountToday(session.user.id),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pui: true },
    }),
    getAcchiVoiceUrlMap(),
    getCharacterImageUrlMap(),
    // promo_until はカラム未追加でも落ちないよう安全に読む (未適用なら null)。
    safeGetPromoUntil(prisma, session.user.id),
  ]);

  const promoActive = isPromoActive(promoUntil);

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      {isPreview && <GamePreviewBanner />}
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
          balance: user?.pui ?? 0,
        }}
        voiceUrls={voiceUrls}
        characterImageUrls={characterImageUrls}
      />
    </div>
  );
}
