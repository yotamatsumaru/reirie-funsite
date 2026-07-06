/**
 * POST /api/super-admin/reward-points/adjust — 管理者による特典ポイント手動調整
 *
 * SUPER_ADMIN 限定。amount は正負どちらも可 (0 は不可)。
 * すべての操作は監査ログに記録される。
 */
import { NextResponse } from 'next/server';
import { AdminAdjustRewardPointsSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { adminAdjustRewardPoints } from '@/lib/points';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = AdminAdjustRewardPointsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const { userId, amount, note } = parsed.data;
  const balance = await adminAdjustRewardPoints(userId, amount, note);

  await logAudit({
    userId: session.user.id,
    action: 'reward_points.admin_adjust',
    resource: `user:${userId}`,
    metadata: { amount, note: note ?? null, balanceAfter: balance },
  });

  return NextResponse.json({ ok: true, userId, amount, balance });
});
