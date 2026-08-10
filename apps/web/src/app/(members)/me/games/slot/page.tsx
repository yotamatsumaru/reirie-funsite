/**
 * /me/games/slot — スロット ミニゲーム。
 *
 * 初期表示に必要な情報 (本日の残り回数 / 残高 / 配当表) はサーバーで解決して
 * クライアントに渡す。これにより、開いた瞬間に API を叩かずに表示できる。
 *
 * ゲームの公開 / 非公開トグル (site.sectionVisibility.gamesVisible) に従う:
 *  - 非公開中の一般会員 / 未ログイン … 404
 *  - 非公開中の管理者 (ADMIN 以上)   … プレビュー表示 (「非公開中」バナー付き)
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import {
  jstDateKey,
  isPromoActive,
  slotRemainingPlays,
  SLOT_MAX_PLAYS_PER_DAY,
  SLOT_MAX_PAYOUT,
  SLOT_PAYOUT,
  EXTRA_PLAY_COST_PUI,
  MAX_EXTRA_PLAYS_PER_DAY,
} from '@idol/shared';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import {
  getSlotPlayCountToday,
  getSlotExtraPlaysToday,
  PROMO_UNLIMITED_REMAINING,
  safeGetPromoUntil,
} from '@/lib/points';
import { resolveGameVisibility } from '@/lib/game-visibility';
import { GamePreviewBanner } from '@/components/game/GamePreviewBanner';
import { SlotGameClient } from './slot-client';

export const metadata: Metadata = { title: 'スロット' };
export const dynamic = 'force-dynamic';

export default async function SlotGamePage() {
  // 非公開中は一般会員には 404。管理者だけはプレビューとしてプレイできる。
  const { canView, isPreview } = await resolveGameVisibility();
  if (!canView) notFound();

  const session = await auth();
  if (!session?.user) {
    redirect('/signin?callbackUrl=/me/games/slot');
  }

  const [playedToday, purchasedExtra, user, promoUntil] = await Promise.all([
    getSlotPlayCountToday(session.user.id),
    getSlotExtraPlaysToday(session.user.id),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pui: true },
    }),
    // promo_until はカラム未追加でも落ちないよう安全に読む (未適用なら null)。
    safeGetPromoUntil(prisma, session.user.id),
  ]);

  const promoActive = isPromoActive(promoUntil);
  const maxPerDay = SLOT_MAX_PLAYS_PER_DAY + purchasedExtra;

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      {isPreview && <GamePreviewBanner />}
      <SlotGameClient
        initial={{
          date: jstDateKey(),
          baseMaxPerDay: SLOT_MAX_PLAYS_PER_DAY,
          maxPerDay,
          playedToday,
          remaining: promoActive
            ? PROMO_UNLIMITED_REMAINING
            : slotRemainingPlays(playedToday, maxPerDay),
          promoActive,
          balance: user?.pui ?? 0,
          maxPayout: SLOT_MAX_PAYOUT,
          payouts: SLOT_PAYOUT,
          extraPlay: {
            purchasedToday: purchasedExtra,
            maxPurchasesPerDay: MAX_EXTRA_PLAYS_PER_DAY,
            costPui: EXTRA_PLAY_COST_PUI,
            canBuyMore: purchasedExtra < MAX_EXTRA_PLAYS_PER_DAY,
          },
        }}
      />
    </div>
  );
}
