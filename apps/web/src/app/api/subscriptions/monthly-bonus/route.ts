/**
 * POST /api/subscriptions/monthly-bonus
 *
 * 月次 Pui ボーナスを全アクティブ会員 (STANDARD / PREMIUM) に付与する Cron 用エンドポイント。
 * 付与量はプラン別 (MONTHLY_PUI_BONUS)。
 *
 * 二重付与防止:
 *   MonthlyRewardPointGrant (userId, yearMonth) UNIQUE 制約で同月再付与を抑止 (grantMonthlyPuiBonus)。
 *
 * ※ 以前は恋愛 ADV 用の「ボーナスギフト (GameItem)」も同時に付与していたが、
 *   恋愛 ADV の提供終了に伴い廃止した。過去の付与履歴 (BonusGiftGrant) は DB に残している。
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
  MONTHLY_PUI_BONUS,
  currentYearMonth,
  type PlanTypeLiteral,
} from '@idol/shared';
import { requireApiSession, resolveApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { env } from '@/lib/env';
import { logAudit } from '@/lib/audit';
import { grantMonthlyPuiBonus } from '@/lib/points';

export const runtime = 'nodejs';

interface GrantResult {
  userId: string;
  plan: PlanTypeLiteral;
  skipped: boolean;
  reason?: string;
  pui?: number;
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
    const result: GrantResult = { userId: sub.userId, plan, skipped: false };
    results.push(result);

    // ===== Pui 月次自動付与 (景品カタログ交換に使う) =====
    try {
      const puiResult = await grantMonthlyPuiBonus(sub.userId, plan, yearMonth);
      if (puiResult.granted) {
        result.pui = puiResult.amount;
        granted++;
      } else {
        result.skipped = true;
        result.reason = 'already_granted_or_not_eligible';
        skipped++;
      }
    } catch {
      result.skipped = true;
      result.reason = 'error';
      skipped++;
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

  const puiGrant = await prisma.monthlyRewardPointGrant.findUnique({
    where: { userId_yearMonth: { userId: session.user.id, yearMonth } },
  });

  return NextResponse.json({
    yearMonth,
    plan,
    eligiblePui: MONTHLY_PUI_BONUS[plan] ?? 0,
    puiGranted: !!puiGrant,
    puiGrant: puiGrant
      ? { pui: puiGrant.pui, grantedAt: puiGrant.grantedAt.toISOString() }
      : null,
    // 以下は恋愛 ADV のボーナスギフト (廃止済み) 用の項目。
    // 既存アプリがキーの存在を前提にしていても落ちないよう、固定値で残している。
    eligibleCount: 0,
    granted: false,
    grant: null,
  });
});
