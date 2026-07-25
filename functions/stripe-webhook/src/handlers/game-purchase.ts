/**
 * ゲーム内課金 (PlayerPurchase) 確定ハンドラ
 *
 * checkout.session.completed の metadata.kind === 'GAME_PURCHASE' で呼ばれる。
 *
 * 本番の Stripe Webhook エンドポイントは Lambda Function URL のみのため、
 * ゲーム内アイテム/章の購入確定もこの Lambda 側で行う必要がある。
 * (アプリ側 /api/game/webhook の GAME_PURCHASE 処理と同一ロジックを踏襲)
 *
 * 冪等性:
 *  - PlayerPurchase.paymentStatus === 'SUCCEEDED' の場合は no-op (二重付与防止)。
 *  - 章 (scenarioId) は upsert、アイテム (itemId) は数量加算。
 *  - 単一トランザクションで購入更新 + インベントリ付与を実行。
 */
import type Stripe from 'stripe';
import { prisma } from '../db';

export async function handleGamePurchase(
  session: Stripe.Checkout.Session,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const meta = (session.metadata ?? {}) as Record<string, string | undefined>;
  const purchaseId = meta.purchaseId;
  const userId = meta.userId;
  const scenarioId = meta.scenarioId || null;
  const itemId = meta.itemId || null;
  const quantity = Number(meta.quantity ?? '1');

  if (!purchaseId || !userId) {
    // eslint-disable-next-line no-console
    console.warn('[stripe-webhook] GAME_PURCHASE missing metadata', {
      purchaseId,
      userId,
      sessionId: session.id,
    });
    return { ok: false, reason: 'missing_metadata' };
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  try {
    await prisma.$transaction(async (tx) => {
      const purchase = await tx.playerPurchase.findUnique({ where: { id: purchaseId } });
      if (!purchase) return;
      if (purchase.paymentStatus === 'SUCCEEDED') return; // 二重防止

      await tx.playerPurchase.update({
        where: { id: purchase.id },
        data: {
          paymentStatus: 'SUCCEEDED',
          paidAt: new Date(),
          stripePaymentIntentId: paymentIntentId,
        },
      });

      if (scenarioId) {
        await tx.playerInventory.upsert({
          where: { userId_scenarioId: { userId, scenarioId } },
          create: { userId, scenarioId, quantity: 1 },
          update: {},
        });
      }
      if (itemId) {
        const inv = await tx.playerInventory.findUnique({
          where: { userId_itemId: { userId, itemId } },
        });
        if (inv) {
          await tx.playerInventory.update({
            where: { id: inv.id },
            data: { quantity: inv.quantity + quantity },
          });
        } else {
          await tx.playerInventory.create({
            data: { userId, itemId, quantity },
          });
        }
      }
    });

    // eslint-disable-next-line no-console
    console.log('[stripe-webhook] game purchase granted', purchaseId);
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] game purchase failed', purchaseId, err);
    throw err;
  }
}
