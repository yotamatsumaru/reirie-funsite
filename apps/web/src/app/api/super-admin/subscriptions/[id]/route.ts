/**
 * PATCH /api/super-admin/subscriptions/[id]
 *   - SUPER_ADMIN 限定: サブスク強制操作
 *
 * body:
 *   { action: 'cancel_immediate' }
 *   { action: 'cancel_at_period_end', value: true | false }
 *
 * Stripe 経由の契約は Stripe 側も解約する (lib/admin-subscription-cancel.ts)。
 * 以前は DB だけ書き換えていたため、請求が続き、次の更新で有料プランが復活していた。
 * 返金は別 API (/refund) で行う。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getStripe } from '@/lib/stripe';
import { applyAdminCancel } from '@/lib/admin-subscription-cancel';

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

    let outcome;
    try {
      outcome = await applyAdminCancel(sub, parsed.data, getStripe);
    } catch (err) {
      // Stripe が失敗した場合は DB を変更していない。理由を管理者に返す
      // eslint-disable-next-line no-console
      console.error('[super-admin/subscriptions] stripe cancel failed', sub.id, err);
      const msg = err instanceof Error ? err.message : String(err);
      throw errors.internal(`Stripe での解約に失敗しました (DB は変更していません): ${msg}`);
    }

    const action =
      parsed.data.action === 'cancel_immediate'
        ? 'subscription.cancel.immediate'
        : parsed.data.value
          ? 'subscription.cancel.schedule'
          : 'subscription.cancel.unschedule';

    await logAudit({
      userId: session.user.id,
      action,
      resource: `subscription:${id}`,
      metadata: {
        subUserId: sub.userId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        stripe: outcome.stripe,
        releasedSchedule: outcome.releasedSchedule,
        ...(parsed.data.action === 'cancel_at_period_end' ? { value: parsed.data.value } : {}),
      },
    });

    return NextResponse.json({ ok: true, ...outcome });
  },
);
