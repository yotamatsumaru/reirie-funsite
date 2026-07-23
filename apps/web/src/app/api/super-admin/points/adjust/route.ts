/**
 * POST /api/super-admin/points/adjust — 管理者による Pui 手動調整
 *
 * SUPER_ADMIN 限定。amount は正負どちらも可 (0 は不可)。
 * 残高がマイナスになる調整は拒否される (PuiIntegrityError → 422)。
 * すべての操作は監査ログに記録される。
 */
import { NextResponse } from 'next/server';
import { AdminAdjustPuiSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { adminAdjustPui } from '@/lib/points';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = AdminAdjustPuiSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const { userId, amount, note } = parsed.data;
  const balance = await adminAdjustPui(userId, amount, note);

  await logAudit({
    userId: session.user.id,
    action: 'points.admin_adjust',
    resource: `user:${userId}`,
    metadata: { amount, note: note ?? null, balanceAfter: balance },
  });

  return NextResponse.json({ ok: true, userId, amount, balance });
});
