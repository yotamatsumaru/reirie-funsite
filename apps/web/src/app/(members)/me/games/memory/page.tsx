/**
 * /me/games/memory — PUI メモリー (神経衰弱)。
 *
 * REIRIE の写真をカードにして、ペアを揃えると Pui がもらえる。
 *
 * 【盤面はサーバーだけが知っている】
 * 初期表示では «盤面» を渡さない。カードの中身は API 経由で
 * めくった 1 枚ずつしか返らない (未めくりカードに写真を含めない)。
 * ここで盤面を渡してしまうと HTML を見るだけで全カードの位置が分かり、
 * ノーミスで Pui を稼げてしまう。
 *
 * ゲームの公開 / 非公開トグルに従う:
 *  - 非公開中の一般会員 / 未ログイン … 404
 *  - 非公開中の管理者 (ADMIN 以上)   … プレビュー表示
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import {
  jstDateKey,
  isPromoActive,
  memoryRemainingPlays,
  MEMORY_MAX_PLAYS_PER_DAY,
  MEMORY_PAIR_COUNT,
  MEMORY_MAX_MOVES,
  MEMORY_PAIR_REWARD,
  MEMORY_CLEAR_BONUS,
  MEMORY_MAX_REWARD,
} from '@idol/shared';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { PROMO_UNLIMITED_REMAINING, safeGetPromoUntil } from '@/lib/points';
import { resolveGameVisibility } from '@/lib/game-visibility';
import { GamePreviewBanner } from '@/components/game/GamePreviewBanner';
import { getMemoryPlayCountToday } from '@/lib/games/memory-store';
import { MemoryGameClient } from './memory-client';

export const metadata: Metadata = { title: 'PUI メモリー' };
export const dynamic = 'force-dynamic';

export default async function MemoryGamePage() {
  const { canView, isPreview } = await resolveGameVisibility('memory');
  if (!canView) notFound();

  const session = await auth();
  if (!session?.user) {
    redirect('/signin?callbackUrl=/me/games/memory');
  }

  const [playedToday, user, promoUntil] = await Promise.all([
    getMemoryPlayCountToday(session.user.id),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pui: true },
    }),
    safeGetPromoUntil(prisma, session.user.id),
  ]);

  const promoActive = isPromoActive(promoUntil);

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      {isPreview && <GamePreviewBanner />}
      <MemoryGameClient
        initial={{
          date: jstDateKey(),
          maxPerDay: MEMORY_MAX_PLAYS_PER_DAY,
          playedToday,
          remaining: promoActive
            ? PROMO_UNLIMITED_REMAINING
            : memoryRemainingPlays(playedToday),
          promoActive,
          balance: user?.pui ?? 0,
          rules: {
            pairCount: MEMORY_PAIR_COUNT,
            maxMoves: MEMORY_MAX_MOVES,
            maxPlaysPerDay: MEMORY_MAX_PLAYS_PER_DAY,
            pairReward: MEMORY_PAIR_REWARD,
            clearBonus: MEMORY_CLEAR_BONUS,
            maxReward: MEMORY_MAX_REWARD,
          },
        }}
      />
    </div>
  );
}
