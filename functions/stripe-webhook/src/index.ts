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
import { getStripe } from './stripe-client';
import { getSecrets } from './secrets';
import {
  handleSubscriptionDeleted,
  handleSubscriptionUpsert,
} from './handlers/subscription';
import { handleCheckoutCompleted } from './handlers/checkout';
import { handleInvoiceFailed, handleInvoicePaid } from './handlers/invoice';
import {
  handlePaymentIntentFailed,
  handlePaymentIntentSucceeded,
} from './handlers/payment-intent';

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

  // SSM から secret を取得 (コンテナ再利用時はキャッシュ)
  let webhookSecret: string;
  let stripe: Stripe;
  try {
    const secrets = await getSecrets();
    webhookSecret = secrets.stripeWebhookSecret;
    stripe = await getStripe();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] failed to resolve secrets from SSM', err);
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
      case 'checkout.session.completed':
        result = await handleCheckoutCompleted(
          stripeEvent.data.object as Stripe.Checkout.Session,
        );
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        result = await handleSubscriptionUpsert(
          stripeEvent.data.object as Stripe.Subscription,
        );
        break;

      case 'customer.subscription.deleted':
        result = await handleSubscriptionDeleted(
          stripeEvent.data.object as Stripe.Subscription,
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

  // 処理成功時に受信記録を残す (再リトライ防止)
  try {
    await prisma.stripeWebhookEvent.upsert({
      where: { id: stripeEvent.id },
      create: {
        id: stripeEvent.id,
        type: stripeEvent.type,
        payload: stripeEvent as unknown as object,
      },
      update: {},
    });
  } catch (err) {
    // 冪等記録失敗は致命ではない (次回の重複検知が効かなくなる程度) のでログのみ
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] failed to record event', err);
  }

  const elapsed = Date.now() - start;
  // eslint-disable-next-line no-console
  console.log(
    '[stripe-webhook] processed',
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
