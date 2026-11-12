/**
 * POST /api/super-admin/mero/adjust — 管理者による Mero の付与 / 減算
 *
 * SUPER_ADMIN 限定。Mero が非公開の間も使える (公開前に運用テストするため)。
 *
 * body: { userId, amount, reason, note? }
 *   amount: 正 = 付与 / 負 = 減算 (0 不可, 1 回 ±100,000 まで)
 *   reason: LIVE_BENEFIT (ライブ特典) / MERCH_BENEFIT (オンライン物販特典) / ADMIN_ADJUST / OTHER
 *   note  : ライブ名・注文番号・調整理由など (履歴に残る)
 *
 * 残高がマイナスになる減算は 422 (MERO_INTEGRITY)。すべての操作を監査ログに記録する。
 */
import { NextResponse } from 'next/server';
import { AdminAdjustMeroSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { adminAdjustMero } from '@/lib/mero';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = AdminAdjustMeroSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const { userId, amount, reason, note } = parsed.data;
  const balance = await adminAdjustMero({
    userId,
    amount,
    reason,
    note,
    actorId: session.user.id,
  });

  await logAudit({
    userId: session.user.id,
    action: 'mero.admin_adjust',
    resource: `user:${userId}`,
    metadata: { amount, reason, note: note ?? null, balanceAfter: balance },
  });

  return NextResponse.json({ ok: true, userId, amount, reason, balance });
});
