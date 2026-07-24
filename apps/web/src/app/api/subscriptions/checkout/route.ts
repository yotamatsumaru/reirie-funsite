import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { CreateCheckoutSessionSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { getStripe, getPriceId, verifyStripeCustomer } from '@/lib/stripe';
import { logAudit } from '@/lib/audit';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = await req.json();
  const input = CreateCheckoutSessionSchema.parse(body);

  // デモモードでは Stripe / DB を無効化しているため、決済フローを実行できない。
  // 生の例外で 500 (「サーバーエラー」) にならないよう、明示的な案内を返す。
  if (env.demoMode) {
    throw errors.badRequest(
      'デモ環境では決済 (プラン加入) はご利用いただけません。本番環境でお試しください。',
    );
  }

  // 既にアクティブなサブスクリプションがある場合は新規加入 (Checkout) を拒否する。
  //   契約期間中のプラン変更は「期間満了時に切り替える予約」(change-plan API) で行う仕様。
  //   これにより二重契約・即時アップグレードを防ぐ (UI をバイパスした直接呼び出し対策)。
  const activeSub = await prisma.subscription.findFirst({
    where: { userId: session.user.id, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (activeSub) {
    throw errors.badRequest(
      '現在ご契約中のプランがあります。プラン変更は「プラン変更を予約」からお手続きください（現在の契約満了時に切り替わります）。',
    );
  }

  const priceId = await getPriceId(input.plan, input.interval);
  if (!priceId) {
    throw errors.badRequest(
      `このプランはただいま受付を準備中です (${input.plan} / ${input.interval})。時間をおいて再度お試しください。`,
    );
  }

  // Stripe シークレットキー未設定時は getStripe() が生の Error を投げて 500 になるため、
  // 事前に検知して分かりやすいエラーを返す。
  let stripe;
  try {
    stripe = await getStripe();
  } catch {
    throw errors.badRequest(
      '決済機能がただいまご利用いただけません。しばらくしてから再度お試しください。',
    );
  }

  // 既存の Customer を再利用 (1ユーザー1顧客)
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw errors.notFound();

  // DB に保存済みの stripeCustomerId が「現在の Stripe モード」に実在するか検証する。
  //   テストモード(sk_test_) で作成した顧客IDが残ったまま本番(sk_live_) に
  //   切り替えると、その顧客IDは本番には存在せず Stripe が
  //   `resource_missing (param: customer)` を返して 400 になる。
  //   実在しない / 削除済みの場合は作り直して DB を更新する (自己回復)。
  let customerId = await verifyStripeCustomer(stripe, user.stripeCustomerId);
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.displayName ?? undefined,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    locale: 'ja',
    allow_promotion_codes: true,
    metadata: { userId: user.id, plan: input.plan, interval: input.interval },
    subscription_data: {
      metadata: { userId: user.id, plan: input.plan, interval: input.interval },
    },
  });

  await logAudit({
    userId: user.id,
    action: 'subscription.checkout.create',
    metadata: { plan: input.plan, interval: input.interval, sessionId: checkout.id },
  });

  return NextResponse.json({ sessionId: checkout.id, url: checkout.url });
});
