/**
 * Pui パック購入の未付与是正 (再照合)
 *
 * GET  /api/super-admin/reward-point-packs/reconcile
 *   - 付与漏れ候補 (status != SUCCEEDED) を Stripe で照合し、
 *     「Stripe 上は支払い済みなのに Pui 未付与」の一覧をプレビュー返却する (書き込みなし)。
 *
 * POST /api/super-admin/reward-point-packs/reconcile
 *   - 上記のうち「Stripe 上 支払い済み」を確定 (grantPuiFromStripePurchase) して Pui を付与する。
 *   - 冪等: 既に SUCCEEDED の購入は付与しない。二重付与は起きない。
 *
 * 背景: 本番 Webhook が Pui パック購入を処理していなかった期間に、
 *       決済は成功したが Pui が付与されていない購入が残っている。
 *       Stripe を正として照合し、実際に支払い済みのものだけを救済する。
 *
 * SUPER_ADMIN 限定。
 */
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getStripe } from '@/lib/stripe';
import { grantPuiFromStripePurchase } from '@/lib/points';

export const runtime = 'nodejs';

/** Stripe 上で「支払い済み」かどうかを判定し、payment_intent id を返す */
async function checkStripePaid(
  stripe: Stripe,
  purchase: {
    stripeCheckoutSessionId: string | null;
    stripePaymentIntentId: string | null;
  },
): Promise<{ paid: boolean; paymentIntentId: string | null; detail: string }> {
  // 1) Checkout Session があればそれで判定 (最も確実)
  if (purchase.stripeCheckoutSessionId) {
    try {
      const s = await stripe.checkout.sessions.retrieve(purchase.stripeCheckoutSessionId);
      const pi =
        typeof s.payment_intent === 'string'
          ? s.payment_intent
          : (s.payment_intent?.id ?? null);
      const paid = s.payment_status === 'paid';
      return {
        paid,
        paymentIntentId: pi,
        detail: `session.payment_status=${s.payment_status}`,
      };
    } catch (e) {
      return {
        paid: false,
        paymentIntentId: null,
        detail: `session_retrieve_failed:${(e as Error).message}`,
      };
    }
  }

  // 2) PaymentIntent だけある場合
  if (purchase.stripePaymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(purchase.stripePaymentIntentId);
      return {
        paid: pi.status === 'succeeded',
        paymentIntentId: pi.id,
        detail: `payment_intent.status=${pi.status}`,
      };
    } catch (e) {
      return {
        paid: false,
        paymentIntentId: null,
        detail: `pi_retrieve_failed:${(e as Error).message}`,
      };
    }
  }

  return { paid: false, paymentIntentId: null, detail: 'no_stripe_reference' };
}

type Candidate = {
  purchaseId: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  packName: string | null;
  pui: number;
  amountJpy: number;
  status: string;
  createdAt: string;
  stripePaid: boolean;
  stripeDetail: string;
};

/** 未付与候補 (SUCCEEDED 以外) を集めて Stripe で照合する */
async function collectCandidates(stripe: Stripe): Promise<Candidate[]> {
  const purchases = await prisma.rewardPointPurchase.findMany({
    where: { status: { not: 'SUCCEEDED' } },
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { email: true, displayName: true } },
      pack: { select: { name: true } },
    },
  });

  const out: Candidate[] = [];
  for (const p of purchases) {
    const chk = await checkStripePaid(stripe, {
      stripeCheckoutSessionId: p.stripeCheckoutSessionId,
      stripePaymentIntentId: p.stripePaymentIntentId,
    });
    out.push({
      purchaseId: p.id,
      userId: p.userId,
      userEmail: p.user?.email ?? null,
      userName: p.user?.displayName ?? null,
      packName: p.pack?.name ?? null,
      pui: p.pui,
      amountJpy: p.amountJpy,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      stripePaid: chk.paid,
      stripeDetail: chk.detail,
    });
  }
  return out;
}

/** GET: プレビュー (書き込みなし) */
export const GET = handle(async () => {
  await requireSuperAdmin();
  const stripe = await getStripe();
  const candidates = await collectCandidates(stripe);

  const grantable = candidates.filter((c) => c.stripePaid);
  return NextResponse.json({
    total: candidates.length,
    grantableCount: grantable.length,
    grantablePui: grantable.reduce((s, c) => s + c.pui, 0),
    candidates,
  });
});

/** POST: 支払い済みの未付与を確定して Pui を付与 */
export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const stripe = await getStripe();

  // 特定の purchaseId 群だけ処理したい場合は body.purchaseIds を受け付ける (任意)
  let onlyIds: Set<string> | null = null;
  try {
    const body = (await req.json()) as { purchaseIds?: string[] } | null;
    if (body?.purchaseIds && Array.isArray(body.purchaseIds) && body.purchaseIds.length > 0) {
      onlyIds = new Set(body.purchaseIds);
    }
  } catch {
    // body 無し = 全件対象
  }

  const candidates = await collectCandidates(stripe);
  const targets = candidates.filter(
    (c) => c.stripePaid && (!onlyIds || onlyIds.has(c.purchaseId)),
  );

  const results: Array<{
    purchaseId: string;
    userId: string;
    pui: number;
    granted: boolean;
    reason?: string;
    balance?: number;
  }> = [];

  let grantedCount = 0;
  let grantedPui = 0;

  for (const t of targets) {
    // payment_intent id を確定するため Stripe を再照合 (支払い済みであることも再確認)
    const purchaseRow = await prisma.rewardPointPurchase.findUnique({
      where: { id: t.purchaseId },
      select: { stripeCheckoutSessionId: true, stripePaymentIntentId: true },
    });
    const paidInfo = purchaseRow
      ? await checkStripePaid(stripe, purchaseRow)
      : { paid: false, paymentIntentId: null, detail: 'not_found' };

    if (!paidInfo.paid) {
      results.push({
        purchaseId: t.purchaseId,
        userId: t.userId,
        pui: t.pui,
        granted: false,
        reason: `not_paid:${paidInfo.detail}`,
      });
      continue;
    }

    const res = await grantPuiFromStripePurchase(t.purchaseId, {
      stripePaymentIntentId: paidInfo.paymentIntentId,
    });

    if (res.ok) {
      grantedCount += 1;
      grantedPui += t.pui;
      results.push({
        purchaseId: t.purchaseId,
        userId: t.userId,
        pui: t.pui,
        granted: true,
        balance: res.balance,
      });
    } else {
      results.push({
        purchaseId: t.purchaseId,
        userId: t.userId,
        pui: t.pui,
        granted: false,
        reason: res.reason,
      });
    }
  }

  await logAudit({
    userId: session.user.id,
    action: 'reward_point_pack.reconcile',
    metadata: {
      candidateCount: candidates.length,
      targetCount: targets.length,
      grantedCount,
      grantedPui,
    },
  });

  return NextResponse.json({
    ok: true,
    grantedCount,
    grantedPui,
    processed: results.length,
    results,
  });
});
