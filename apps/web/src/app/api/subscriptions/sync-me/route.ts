/**
 * POST /api/subscriptions/sync-me
 *   ログイン中の本人が、自分自身の Stripe サブスクを取得して DB を Stripe に合わせる。
 *
 * ## 背景 (根本対策: Webhook 取りこぼしの自己回復)
 *   Stripe Checkout での決済が成功しても、`customer.subscription.*` Webhook が
 *   何らかの理由 (設定漏れ・一時的な取りこぼし・配信遅延) で届かないと、
 *   DB の Subscription が作られないまま会員は無条件で FREE 扱いになる
 *   (packages/shared/src/schemas/subscription-health.ts 参照)。
 *
 *   これまでは会員からの「支払ったのに反映されない」という問い合わせを受けて、
 *   SUPER_ADMIN が `/super-admin/users/[id]` で手動同期するまで直らなかった。
 *
 *   このエンドポイントは Checkout 成功直後 (`/me?subscribed=1`) に自動で呼び出され、
 *   Webhook を待たずにその場で Stripe の実データを取得して DB を修復する
 *   「セルフサービス型の自己回復」を実現する。
 *   (SubscribedRefresh コンポーネントから呼ばれる。詳細はそちらのコメント参照)
 *
 * ## 安全性
 *   - 認証必須。呼び出し元は自分自身の stripeCustomerId のみを対象にする
 *     (他ユーザーのサブスクには一切触れられない)。
 *   - 冪等: Stripe の実データに合わせて upsert するだけなので、何度呼んでも安全。
 *   - Stripe 未紐付け/未設定の場合は静かに「変更なし」を返す (エラーにしない)。
 *     Checkout 直後の自動呼び出しなので、ユーザー体験を壊さないことを優先する。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';
import { getStripe, verifyStripeCustomer } from '@/lib/stripe';
import { logAudit } from '@/lib/audit';
import { syncSubscriptionsForCustomer } from '@/lib/subscription-sync';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    return NextResponse.json({ ok: true, synced: false, reason: 'user_not_found' });
  }

  let stripe;
  try {
    stripe = await getStripe();
  } catch {
    // Stripe 未設定 (デモ環境等) — 何もせず静かに終了
    return NextResponse.json({ ok: true, synced: false, reason: 'stripe_unavailable' });
  }

  const customerId = await verifyStripeCustomer(stripe, user.stripeCustomerId);
  if (!customerId) {
    // まだ一度も決済していない、またはテスト/本番モード不一致 — 通常のフローなのでエラーにしない
    return NextResponse.json({ ok: true, synced: false, reason: 'no_stripe_customer' });
  }

  let result;
  try {
    result = await syncSubscriptionsForCustomer(stripe, user.id, customerId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[subscriptions/sync-me] sync failed', user.id, (e as Error).message);
    return NextResponse.json({ ok: true, synced: false, reason: 'stripe_error' });
  }

  // 何かしら Stripe 側に見つかった場合のみ監査ログに残す (no-op の空振りは記録しない)
  if (result.results.length > 0) {
    await logAudit({
      userId: user.id,
      action: 'subscription.sync.self',
      resource: `user:${user.id}`,
      metadata: { customerId, ...result },
    });
  }

  return NextResponse.json({ ok: true, synced: true, ...result });
});
