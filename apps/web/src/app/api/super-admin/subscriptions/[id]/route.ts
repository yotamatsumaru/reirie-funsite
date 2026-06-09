/**
 * PATCH /api/super-admin/subscriptions/[id]
 *   - SUPER_ADMIN 限定: サブスク強制操作
 *
 * body:
 *   { action: 'cancel_immediate' }
 *   { action: 'cancel_at_period_end', value: true | false }
 *
 * Note: 実本番では Stripe API を呼んで cancel する必要がある。
 *       ここでは DB だけ更新 (デモ用) + 監査ログ。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const PatchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel_immediate') }),
  z.object({ action: z.literal('cancel_at_period_end'), value: z.boolean() }),
]);

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;

    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
    }

    const sub = await prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw errors.notFound('サブスクが見つかりません');

    if (parsed.data.action === 'cancel_immediate') {
      await prisma.subscription.update({
        where: { id },
        data: { status: 'CANCELED', cancelAtPeriodEnd: false },
      });
      await logAudit({
        userId: session.user.id,
        action: 'subscription.cancel.immediate',
        resource: `subscription:${id}`,
        metadata: { subUserId: sub.userId },
      });
      return NextResponse.json({ ok: true });
    }

    // cancel_at_period_end
    await prisma.subscription.update({
      where: { id },
      data: { cancelAtPeriodEnd: parsed.data.value },
    });
    await logAudit({
      userId: session.user.id,
      action: parsed.data.value
        ? 'subscription.cancel.schedule'
        : 'subscription.cancel.unschedule',
      resource: `subscription:${id}`,
      metadata: { value: parsed.data.value },
    });
    return NextResponse.json({ ok: true });
  },
);
