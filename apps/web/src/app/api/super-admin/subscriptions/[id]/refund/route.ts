/**
 * サブスクリプション課金の返金 (SUPER_ADMIN 限定)
 *
 * GET  /api/super-admin/subscriptions/[id]/refund
 *   - 対象サブスクに紐づく課金 (Payment kind=SUBSCRIPTION) の一覧を返す。
 *     返金 UI で「どの課金を返金するか」を選ぶために使う (書き込みなし)。
 *
 * POST /api/super-admin/subscriptions/[id]/refund
 *   - body: { paymentId: string, amount?: number }
 *   - 指定した課金を Stripe API で実際に返金する (stripe.refunds.create)。
 *   - amount 未指定なら全額返金。指定時は一部返金 (円単位、0 < amount <= 課金額)。
 *   - 返金に成功したら Payment.status を REFUNDED に更新し、監査ログを残す。
 *   - 冪等: 既に REFUNDED の課金は Stripe を叩かず ALREADY_REFUNDED を返す。
 *
 * 【重要】返金は Stripe 上の PaymentIntent / Charge に対して行う。
 *   Payment には stripePaymentIntentId / stripeChargeId が保存されているので
 *   それを使う。どちらも無い (古いデータ等) 場合は返金できない旨を返す。
 */
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

const PostSchema = z.object({
  paymentId: z.string().uuid('paymentId が不正です'),
  // 一部返金用 (円単位)。未指定なら全額返金。
  amount: z.number().int().positive().optional(),
});

/** 対象サブスクに紐づく課金一覧 (返金 UI 用) を返す */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireSuperAdmin();
  const { id } = await ctx.params;

  const sub = await prisma.subscription.findUnique({
    where: { id },
    select: { id: true, userId: true, planType: true, billingInterval: true },
  });
  if (!sub) throw errors.notFound('サブスクが見つかりません');

  const payments = await prisma.payment.findMany({
    where: { subscriptionId: id, kind: 'SUBSCRIPTION' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      createdAt: true,
      stripePaymentIntentId: true,
      stripeChargeId: true,
      stripeInvoiceId: true,
      receiptUrl: true,
    },
  });

  return NextResponse.json({
    subscription: sub,
    payments: payments.map((p) => ({
      ...p,
      // 返金可能かどうか (成功済み かつ Stripe 参照がある)
      refundable:
        p.status === 'SUCCEEDED' && Boolean(p.stripePaymentIntentId || p.stripeChargeId),
      createdAt: p.createdAt.toISOString(),
    })),
  });
});

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireSuperAdmin();
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }
  const { paymentId, amount } = parsed.data;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      userId: true,
      kind: true,
      status: true,
      amount: true,
      currency: true,
      subscriptionId: true,
      stripePaymentIntentId: true,
      stripeChargeId: true,
    },
  });

  // 対象サブスクに属する課金であることを厳密に確認する
  if (!payment || payment.subscriptionId !== id || payment.kind !== 'SUBSCRIPTION') {
    throw errors.notFound('対象の課金が見つかりません');
  }

  // 冪等: 既に返金済みなら Stripe を叩かない
  if (payment.status === 'REFUNDED') {
    return NextResponse.json({ ok: true, alreadyRefunded: true });
  }

  if (payment.status !== 'SUCCEEDED') {
    throw errors.unprocessable('成功した課金のみ返金できます', {
      status: payment.status,
    });
  }

  // 一部返金の金額バリデーション
  if (amount != null && amount > payment.amount) {
    throw errors.unprocessable('返金額が課金額を超えています', {
      amount,
      paymentAmount: payment.amount,
    });
  }

  if (!payment.stripePaymentIntentId && !payment.stripeChargeId) {
    throw errors.unprocessable(
      'Stripe の参照 (PaymentIntent / Charge) が無いため自動返金できません。Stripe 管理画面から対応してください。',
    );
  }

  const stripe = await getStripe();

  // Stripe 返金の作成。PaymentIntent 優先 (Invoice 課金は PI が確実に付く)。
  const refundParams: Stripe.RefundCreateParams = {
    // JPY は最小単位が「円」なので amount はそのまま渡してよい (ゼロ小数通貨)
    ...(amount != null ? { amount } : {}),
    metadata: {
      source: 'super-admin.subscription.refund',
      paymentId: payment.id,
      subscriptionId: id,
      operatorUserId: session.user.id,
    },
  };
  if (payment.stripePaymentIntentId) {
    refundParams.payment_intent = payment.stripePaymentIntentId;
  } else if (payment.stripeChargeId) {
    refundParams.charge = payment.stripeChargeId;
  }

  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(refundParams);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Stripe 返金に失敗しました';
    // Stripe 側で既に全額返金済み等のケースは冪等に扱う
    if (/already been refunded|has already/i.test(message)) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
      return NextResponse.json({ ok: true, alreadyRefunded: true });
    }
    throw errors.unprocessable(`Stripe 返金に失敗しました: ${message}`);
  }

  // 全額返金のときのみ Payment を REFUNDED にする。
  // 一部返金は課金自体は成功状態のまま (Stripe 側に返金履歴が残る)。
  const isFullRefund = amount == null || amount >= payment.amount;
  if (isFullRefund) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED' },
    });
  }

  await logAudit({
    userId: session.user.id,
    action: isFullRefund ? 'subscription.payment.refund' : 'subscription.payment.refund.partial',
    resource: `payment:${payment.id}`,
    metadata: {
      subscriptionId: id,
      refundId: refund.id,
      refundAmount: refund.amount,
      paymentAmount: payment.amount,
      subUserId: payment.userId,
    },
  });

  return NextResponse.json({
    ok: true,
    refundId: refund.id,
    refundAmount: refund.amount,
    isFullRefund,
  });
});
