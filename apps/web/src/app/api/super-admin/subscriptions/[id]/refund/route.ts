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
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

const PostSchema = z.object({
  paymentId: z.string().uuid('paymentId が不正です'),
  // 一部返金用 (円単位)。未指定なら全額返金。
  amount: z.number().int().positive().optional(),
});

/**
 * 対象サブスクに紐づく「はぐれ課金」を Stripe 上の真実で特定し、
 * Payment.subscriptionId を backfill (補正) する。
 *
 * ## なぜ必要か
 *   サブスク継続課金の Payment は invoice.payment_succeeded webhook で作られるが、
 *   その時点で Subscription 行が未作成 (customer.subscription.* の取りこぼし等) だと
 *   userId は customer から救済される一方で subscriptionId が null のまま保存される
 *   ことがある。すると本 API の「subscriptionId 完全一致」検索に引っかからず、
 *   返金モーダルで「この契約に紐づく課金がありません」と表示されてしまう。
 *
 * ## 何をするか
 *   同じ userId・kind=SUBSCRIPTION で subscriptionId が null の課金を対象に、
 *   Stripe 上の Invoice.subscription が当該サブスクの stripeSubscriptionId と
 *   一致するものだけを、この契約 (sub.id) に結び付ける。
 *   Stripe 参照が無い等で確認できない課金は触らない (誤紐付けを避ける)。
 *
 *   Stripe 呼び出しに失敗しても致命的ではないため握りつぶす (一覧表示は継続)。
 */
async function backfillOrphanSubscriptionPayments(sub: {
  id: string;
  userId: string;
  stripeSubscriptionId: string;
}): Promise<void> {
  const orphans = await prisma.payment.findMany({
    where: {
      userId: sub.userId,
      kind: 'SUBSCRIPTION',
      subscriptionId: null,
    },
    select: {
      id: true,
      stripeInvoiceId: true,
      stripePaymentIntentId: true,
      stripeChargeId: true,
    },
  });
  if (orphans.length === 0) return;

  let stripe: Awaited<ReturnType<typeof getStripe>>;
  try {
    stripe = await getStripe();
  } catch {
    // Stripe クライアントが用意できない環境では補正をスキップ
    return;
  }

  for (const o of orphans) {
    if (!o.stripeInvoiceId) continue;
    try {
      const invoice = await stripe.invoices.retrieve(o.stripeInvoiceId);
      const subId = (invoice as unknown as { subscription?: string | { id: string } })
        .subscription;
      const invoiceSubId = typeof subId === 'string' ? subId : subId?.id;
      if (!invoiceSubId || invoiceSubId !== sub.stripeSubscriptionId) continue;

      // この契約の課金と確定。subscriptionId を補正しつつ、
      // 返金に必要な PaymentIntent / Charge が欠けていれば Invoice から補完する。
      const invoicePi = (invoice as unknown as { payment_intent?: string | { id: string } })
        .payment_intent;
      const paymentIntentId =
        typeof invoicePi === 'string' ? invoicePi : (invoicePi?.id ?? null);
      const invoiceCharge = (invoice as unknown as { charge?: string | { id: string } }).charge;
      const chargeId =
        typeof invoiceCharge === 'string' ? invoiceCharge : (invoiceCharge?.id ?? null);

      await prisma.payment.update({
        where: { id: o.id },
        data: {
          subscriptionId: sub.id,
          ...(o.stripePaymentIntentId == null && paymentIntentId != null
            ? { stripePaymentIntentId: paymentIntentId }
            : {}),
          ...(o.stripeChargeId == null && chargeId != null
            ? { stripeChargeId: chargeId }
            : {}),
        },
      });
    } catch {
      // 個別 Invoice の取得失敗は無視して次へ
    }
  }
}

/** 対象サブスクに紐づく課金一覧 (返金 UI 用) を返す */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireSuperAdminView();
  const { id } = await ctx.params;

  const sub = await prisma.subscription.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      planType: true,
      billingInterval: true,
      stripeSubscriptionId: true,
    },
  });
  if (!sub) throw errors.notFound('サブスクが見つかりません');

  // 先にはぐれ課金を Stripe の真実で当該契約へ補正する。
  // (webhook 実行時に subscriptionId が null のまま保存された課金を救済)
  await backfillOrphanSubscriptionPayments(sub);

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
    subscription: {
      id: sub.id,
      userId: sub.userId,
      planType: sub.planType,
      billingInterval: sub.billingInterval,
    },
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
