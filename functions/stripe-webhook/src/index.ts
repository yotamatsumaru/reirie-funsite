/**
 * Stripe Webhook Lambda エントリポイント
 *
 * - Lambda Function URL から呼び出される (API Gateway 不要)
 * - Stripe-Signature ヘッダで署名検証
 * - 受信した event を stripe_webhook_events に upsert (冪等性)
 * - event.type に応じて handler を dispatch
 *
 * ## 重要なルール
 * - Stripe には 2xx を 5 秒以内に返す必要があるため、
 *   重い処理は handler 内で完了させ、必要なら SQS 等に投げ直す。
 * - エラー時は 5xx を返すと Stripe が自動リトライしてくれる (最大3日間)。
 * - すでに処理済みの event.id は冪等に no-op。
 */
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import type Stripe from 'stripe';
import { prisma } from './db';
import { getStripeForKey } from './stripe-client';
import { resolveStripeRuntime } from './secrets';
import {
  handleSubscriptionDeleted,
  handleSubscriptionUpsert,
} from './handlers/subscription';
import { handleCheckoutCompleted } from './handlers/checkout';
import { handleRewardPointPurchase } from './handlers/reward-point';
import { handleGamePurchase } from './handlers/game-purchase';
import { handleInvoiceFailed, handleInvoicePaid } from './handlers/invoice';
import {
  handlePaymentIntentFailed,
  handlePaymentIntentSucceeded,
} from './handlers/payment-intent';
import { isActionableWebhookReason, resolveWebhookOutcome } from '@idol/shared';

/**
 * イベントの payload から Stripe の顧客 ID を取り出す。
 *
 * 取りこぼし (user_not_found) が起きたとき、あとから
 * 「どの顧客の決済が宙に浮いているか」を管理画面で追跡するために保存する。
 * これが無いと、記録が残っても復旧対象を特定できない。
 */
function extractCustomerId(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as {
    customer?: string | { id?: string } | null;
  };
  const c = obj?.customer;
  if (!c) return null;
  return typeof c === 'string' ? c : (c.id ?? null);
}

type Result = APIGatewayProxyStructuredResultV2;

function jsonResponse(status: number, body: unknown): Result {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * raw body を取得 (Function URL は base64 でエンコードされてくる場合あり)
 */
function getRawBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

/**
 * 大文字小文字非依存でヘッダを取得
 */
function getHeader(
  headers: APIGatewayProxyEventV2['headers'],
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v as string | undefined;
  }
  return undefined;
}

export const handler = async (
  event: APIGatewayProxyEventV2,
  _ctx: Context,
): Promise<Result> => {
  const start = Date.now();

  // --- 診断モード (VPC 内 DB を Lambda 経由で確認する) ---
  // Function URL 経由ではなく、直接 Lambda invoke で
  //   { "__diag": "subscriptions", "email": "user@example.com" }
  // を渡すと、DB のサブスク状況を返す。stripe-signature が無いため
  // 通常の Webhook フローとは干渉しない。運用: 一時的な調査用。
  const diag = (event as unknown as { __diag?: string; email?: string }).__diag;
  if (diag === 'subscriptions') {
    const email = (event as unknown as { email?: string }).email;
    try {
      const subs = await prisma.subscription.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { user: { select: { id: true, email: true, displayName: true } } },
      });
      const recent = subs.map((s) => ({
        createdAt: s.createdAt.toISOString(),
        plan: s.planType,
        status: s.status,
        interval: s.billingInterval,
        priceId: s.stripePriceId,
        userEmail: s.user?.email ?? null,
        userId: s.userId,
        stripeSubscriptionId: s.stripeSubscriptionId,
        stripeCustomerId: s.stripeCustomerId,
      }));
      let userReport: unknown = null;
      if (email) {
        const u = await prisma.user.findUnique({
          where: { email },
          include: { subscriptions: { orderBy: { createdAt: 'desc' } } },
        });
        if (!u) {
          userReport = { found: false, email };
        } else {
          const active = u.subscriptions.filter((s) =>
            ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(s.status),
          );
          userReport = {
            found: true,
            email,
            userId: u.id,
            displayName: u.displayName,
            stripeCustomerId: u.stripeCustomerId,
            totalSubscriptions: u.subscriptions.length,
            activeSubscriptions: active.length,
            derivedPlan: active[0]?.planType ?? 'FREE',
          };
        }
      }
      return jsonResponse(200, { diag: 'subscriptions', recent, user: userReport });
    } catch (err) {
      return jsonResponse(500, { diag: 'subscriptions', error: (err as Error).message });
    }
  }
  // --- 診断モードここまで ---

  const sigHeader =
    getHeader(event.headers, 'stripe-signature') ??
    getHeader(event.headers, 'Stripe-Signature');

  if (!sigHeader) {
    return jsonResponse(400, { error: 'missing_stripe_signature' });
  }

  const rawBody = getRawBody(event);
  if (!rawBody) {
    return jsonResponse(400, { error: 'empty_body' });
  }

  // 現在の有効モード (LIVE / TEST) を解決してキー・Webhook Secret・Price ID を取得する。
  //   - LIVE: SSM の本番キー
  //   - TEST: 管理画面 (AppSetting) のテストキー
  // これにより Stripe テストモードで送られたイベントも、テストの Webhook Secret で
  // 署名検証できるようになり、プラン/ランクが正しく反映される。
  let webhookSecret: string;
  let stripe: Stripe;
  let runtimeMode: 'LIVE' | 'TEST';
  let runtimePrices: Parameters<typeof handleSubscriptionUpsert>[1];
  try {
    const runtime = await resolveStripeRuntime();
    webhookSecret = runtime.webhookSecret;
    stripe = getStripeForKey(runtime.secretKey);
    runtimeMode = runtime.mode;
    runtimePrices = runtime.prices;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] failed to resolve Stripe runtime (SSM/DB)', err);
    return jsonResponse(500, { error: 'secrets_unavailable' });
  }

  // 署名検証
  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[stripe-webhook] signature verification failed', (err as Error).message);
    return jsonResponse(400, { error: 'invalid_signature' });
  }

  // 冪等性: 既に処理済みなら早期 return
  // upsert を「create-only-if-not-exists」相当で使うため、既存があれば no-op
  try {
    const existing = await prisma.stripeWebhookEvent.findUnique({
      where: { id: stripeEvent.id },
    });
    if (existing) {
      // eslint-disable-next-line no-console
      console.log('[stripe-webhook] duplicate event skipped', stripeEvent.id, stripeEvent.type);
      return jsonResponse(200, { received: true, duplicate: true });
    }
  } catch (err) {
    // 冪等性チェックの失敗は処理を止めるほどではないが、念のためログ
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] idempotency check failed', err);
  }

  // dispatch
  let result: { ok: boolean; reason?: string } = { ok: true };
  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object as Stripe.Checkout.Session;
        const kind = (session.metadata ?? {})['kind'];
        if (kind === 'REWARD_POINT_PURCHASE') {
          // Pui パック購入は専用ハンドラで確定 + Pui 付与
          result = await handleRewardPointPurchase(session);
        } else if (kind === 'GAME_PURCHASE') {
          // ゲーム内課金 (章/アイテム) は専用ハンドラでインベントリ付与
          result = await handleGamePurchase(session);
        } else {
          // 物販 Order (metadata.orderId) 等は従来ハンドラで処理
          result = await handleCheckoutCompleted(session);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        result = await handleSubscriptionUpsert(
          stripeEvent.data.object as Stripe.Subscription,
          runtimePrices,
        );
        break;

      case 'customer.subscription.deleted':
        result = await handleSubscriptionDeleted(
          stripeEvent.data.object as Stripe.Subscription,
          runtimePrices,
        );
        break;

      case 'invoice.payment_succeeded':
      case 'invoice.paid':
        result = await handleInvoicePaid(stripeEvent.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        result = await handleInvoiceFailed(stripeEvent.data.object as Stripe.Invoice);
        break;

      case 'payment_intent.succeeded':
        result = await handlePaymentIntentSucceeded(
          stripeEvent.data.object as Stripe.PaymentIntent,
        );
        break;

      case 'payment_intent.payment_failed':
        result = await handlePaymentIntentFailed(
          stripeEvent.data.object as Stripe.PaymentIntent,
        );
        break;

      default:
        // 未対応イベント: 200 で受信記録だけ残す (Stripe の再送を止める)
        result = { ok: true };
        break;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] handler error', stripeEvent.type, stripeEvent.id, err);
    // 5xx を返して Stripe にリトライさせる (冪等記録はまだしていないので安全)
    return jsonResponse(500, { error: 'handler_error', type: stripeEvent.type });
  }

  // ---------------------------------------------------------------------
  // 受信記録を残す (再リトライ防止 + 取りこぼしの追跡)
  //
  // 【重要】ここで処理結果 (outcome / skipReason) も併せて保存する。
  //   従来は payload だけを保存していたため、ハンドラが
  //   { ok: false, reason: 'user_not_found' } を返しても
  //   「Stripe に 200 を返す → Stripe は再送しない → 記録も残らない」
  //   となり、会員が「支払ったのにプランが反映されない」と申告してくるまで
  //   運営が気づく手段が一切無かった。
  //   結果を残すことで、管理画面から能動的に取りこぼしを検知できる。
  // ---------------------------------------------------------------------
  const { outcome, reason: skipReason } = resolveWebhookOutcome(result);
  try {
    await prisma.stripeWebhookEvent.upsert({
      where: { id: stripeEvent.id },
      create: {
        id: stripeEvent.id,
        type: stripeEvent.type,
        payload: stripeEvent as unknown as object,
        outcome,
        skipReason,
        stripeCustomerId: extractCustomerId(stripeEvent),
      },
      update: {},
    });
  } catch (err) {
    // 冪等記録失敗は致命ではない (次回の重複検知が効かなくなる程度) のでログのみ
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] failed to record event', err);
  }

  // 会員に実害が出るスキップ (user_not_found) は、ログでも一目で分かるよう
  // error レベルで出す。CloudWatch のメトリクスフィルタで拾えるようにするため
  // 固定の目印 (SUBSCRIPTION_MISMATCH) を付ける。
  if (isActionableWebhookReason(skipReason)) {
    // eslint-disable-next-line no-console
    console.error(
      '[stripe-webhook] SUBSCRIPTION_MISMATCH 決済を会員に紐付けられませんでした',
      JSON.stringify({
        eventId: stripeEvent.id,
        type: stripeEvent.type,
        reason: skipReason,
        customerId: extractCustomerId(stripeEvent),
      }),
    );
  }

  const elapsed = Date.now() - start;
  // eslint-disable-next-line no-console
  console.log(
    '[stripe-webhook] processed',
    `mode=${runtimeMode}`,
    stripeEvent.type,
    stripeEvent.id,
    `${elapsed}ms`,
    result.ok ? 'ok' : `skip:${result.reason ?? 'unknown'}`,
  );

  return jsonResponse(200, {
    received: true,
    type: stripeEvent.type,
    handled: result.ok,
    reason: result.reason,
  });
};
