/**
 * POST /api/subscriptions/monthly-bonus
 *
 * 月次ボーナスギフトを全アクティブ会員に付与する Cron 用エンドポイント。
 *
 * - STANDARD 会員: 1 個/月
 * - PREMIUM 会員 : 5 個/月
 *
 * 二重付与防止:
 *   BonusGiftGrant (userId, yearMonth) UNIQUE 制約で同月再付与を抑止。
 *
 * 認証:
 *   - x-cron-secret ヘッダで CRON_SECRET と一致 → 内部呼び出し許可
 *   - もしくはログイン中の管理者
 *
 * GET /api/subscriptions/monthly-bonus
 *   現ユーザーの今月の受給状況を取得 (UI 表示用)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import {
  MONTHLY_BONUS_GIFT_COUNT,
  DEFAULT_BONUS_GIFT_SLUG,
  MONTHLY_REWARD_POINT_BONUS,
  currentYearMonth,
  type PlanTypeLiteral,
} from '@idol/shared';
import { requireApiSession, resolveApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { env } from '@/lib/env';
import { logAudit } from '@/lib/audit';
import { grantMonthlyRewardPointBonus } from '@/lib/points';

export const runtime = 'nodejs';

interface GrantResult {
  userId: string;
  plan: PlanTypeLiteral;
  count: number;
  skipped: boolean;
  reason?: string;
  rewardPoints?: number;
  rewardPointsSkipped?: boolean;
}

export const POST = handle(async (req: Request) => {
  // ===== 認証 =====
  const cronSecret = req.headers.get('x-cron-secret');
  const validCron = cronSecret && env.cron?.secret && cronSecret === env.cron.secret;
  if (!validCron) {
    const session = await resolveApiSession(req);
    if (!session?.user?.id || session.user.role !== 'ADMIN') {
      throw errors.forbidden('Cron secret もしくは管理者権限が必要です');
    }
  }

  const yearMonth = currentYearMonth();

  // ===== ボーナスアイテムを解決 =====
  const bonusItem = await prisma.gameItem.findUnique({
    where: { slug: DEFAULT_BONUS_GIFT_SLUG },
  });
  if (!bonusItem) {
    throw errors.badRequest(
      `ボーナスアイテム slug "${DEFAULT_BONUS_GIFT_SLUG}" が GameItem に見つかりません。先に管理画面で作成してください。`,
    );
  }

  // ===== アクティブ会員 (STANDARD / PREMIUM) を抽出 =====
  const activeSubs = await prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'TRIALING'] },
      planType: { in: ['STANDARD', 'PREMIUM'] },
    },
    distinct: ['userId'],
    orderBy: { createdAt: 'desc' },
    select: { userId: true, planType: true },
  });

  const results: GrantResult[] = [];
  let granted = 0;
  let skipped = 0;

  for (const sub of activeSubs) {
    const plan = sub.planType as PlanTypeLiteral;
    const count = MONTHLY_BONUS_GIFT_COUNT[plan];
    if (count <= 0) {
      results.push({ userId: sub.userId, plan, count: 0, skipped: true, reason: 'no_bonus_for_plan' });
      skipped++;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // 1) 二重付与防止: 既存レコードチェック
        const existing = await tx.bonusGiftGrant.findUnique({
          where: { userId_yearMonth: { userId: sub.userId, yearMonth } },
        });
        if (existing) {
          throw new Error('ALREADY_GRANTED');
        }

        // 2) BonusGiftGrant 作成
        await tx.bonusGiftGrant.create({
          data: {
            userId: sub.userId,
            yearMonth,
            plan,
            count,
            itemId: bonusItem.id,
          },
        });

        // 3) PlayerInventory に加算 (upsert)
        const inv = await tx.playerInventory.findUnique({
          where: { userId_itemId: { userId: sub.userId, itemId: bonusItem.id } },
        });
        if (inv) {
          await tx.playerInventory.update({
            where: { id: inv.id },
            data: { quantity: inv.quantity + count },
          });
        } else {
          await tx.playerInventory.create({
            data: { userId: sub.userId, itemId: bonusItem.id, quantity: count },
          });
        }
      });

      results.push({ userId: sub.userId, plan, count, skipped: false });
      granted++;
    } catch (e) {
      const reason = e instanceof Error && e.message === 'ALREADY_GRANTED' ? 'already_granted' : 'error';
      results.push({ userId: sub.userId, plan, count: 0, skipped: true, reason });
      skipped++;
    }

    // ===== 特典ポイント月次自動付与 (景品カタログ交換に使う方) =====
    // ギフト付与とは独立した二重付与防止 (MonthlyRewardPointGrant) を持つため、
    // ギフト付与の成否に関わらず個別に試行する。
    try {
      const rewardResult = await grantMonthlyRewardPointBonus(sub.userId, plan, yearMonth);
      const last = results[results.length - 1];
      if (rewardResult.granted) {
        last.rewardPoints = rewardResult.amount;
      } else {
        last.rewardPointsSkipped = true;
      }
    } catch {
      const last = results[results.length - 1];
      last.rewardPointsSkipped = true;
    }
  }

  // 監査ログ
  await logAudit({
    userId: validCron ? null : (await resolveApiSession(req))?.user?.id ?? null,
    action: 'MONTHLY_BONUS_GRANT',
    resource: yearMonth,
    metadata: {
      via: validCron ? 'cron' : 'admin',
      granted,
      skipped,
      total: activeSubs.length,
    },
  }).catch(() => {});

  return NextResponse.json({
    yearMonth,
    total: activeSubs.length,
    granted,
    skipped,
    results: results.slice(0, 100), // 大量データは省略
  });
});

export const GET = handle(async (req: Request) => {
  // 自分の今月の受給状況を取得
  const session = await requireApiSession(req);
  const yearMonth = currentYearMonth();
  const plan = session.user.plan;
  const eligibleCount = MONTHLY_BONUS_GIFT_COUNT[plan];

  const [grant, rewardGrant] = await Promise.all([
    prisma.bonusGiftGrant.findUnique({
      where: { userId_yearMonth: { userId: session.user.id, yearMonth } },
      include: { item: { select: { name: true, iconUrl: true, slug: true } } },
    }),
    prisma.monthlyRewardPointGrant.findUnique({
      where: { userId_yearMonth: { userId: session.user.id, yearMonth } },
    }),
  ]);

  return NextResponse.json({
    yearMonth,
    plan,
    eligibleCount,
    eligibleRewardPoints: MONTHLY_REWARD_POINT_BONUS[plan] ?? 0,
    rewardPointsGranted: !!rewardGrant,
    rewardPointsGrant: rewardGrant
      ? { points: rewardGrant.points, grantedAt: rewardGrant.grantedAt.toISOString() }
      : null,
    granted: !!grant,
    grant: grant
      ? {
          count: grant.count,
          item: grant.item,
          grantedAt: grant.grantedAt.toISOString(),
        }
      : null,
  });
});
