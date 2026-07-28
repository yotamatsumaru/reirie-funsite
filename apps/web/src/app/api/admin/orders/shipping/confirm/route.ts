/**
 * POST /api/admin/orders/shipping/confirm
 *   - プレビューで確認した (注文番号, 送り状番号) の組を受け取り、
 *     対象注文を一括で SHIPPED に遷移させ、送り状番号を保存する。
 *   - 単品発送 (/api/admin/orders/[id]/ship) と同じ在庫処理:
 *       reserved を解放しつつ quantity を実減算 (1注文=1トランザクション)。
 *   - notifyCustomer=true のとき、発送メールをまとめて送る。
 *   - BASE 相当のワークフロー ③: 送り状番号の一括紐づけ + 発送通知の一括送信。
 *
 *   注文単位でトランザクションを分けることで、一部の注文で失敗しても
 *   他の注文の発送は成立させる (結果を per-order で返す)。
 *
 *   権限: MERCH。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { BulkShipConfirmSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';

export const runtime = 'nodejs';

type ResultStatus = 'shipped' | 'not_found' | 'not_shippable' | 'error';

interface OrderResult {
  orderNumber: string;
  trackingNumber: string;
  status: ResultStatus;
  message?: string;
  emailSent?: boolean;
}

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('MERCH');
  const { entries, notifyCustomer } = BulkShipConfirmSchema.parse(await req.json());

  // 同じ注文番号が複数回来た場合は最後の送り状番号を採用 (重複排除)。
  const byOrderNumber = new Map<string, string>();
  for (const e of entries) byOrderNumber.set(e.orderNumber, e.trackingNumber);

  const results: OrderResult[] = [];
  let shippedCount = 0;
  let emailCount = 0;

  for (const [orderNumber, trackingNumber] of byOrderNumber) {
    try {
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        include: {
          items: true,
          user: { select: { email: true, displayName: true } },
        },
      });

      if (!order) {
        results.push({ orderNumber, trackingNumber, status: 'not_found' });
        continue;
      }
      if (order.status !== 'PAID' && order.status !== 'PROCESSING') {
        results.push({
          orderNumber,
          trackingNumber,
          status: 'not_shippable',
          message: `出荷可能な状態ではありません (現在: ${order.status})`,
        });
        continue;
      }

      // 在庫: reserved を解放しつつ quantity を実減算 (1トランザクション)
      await prisma.$transaction(async (tx) => {
        for (const item of order.items) {
          await tx.inventory.update({
            where: { variantId: item.variantId },
            data: {
              quantity: { decrement: item.quantity },
              reserved: { decrement: item.quantity },
            },
          });
        }
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'SHIPPED',
            trackingNumber,
            shippedAt: new Date(),
          },
        });
      });
      shippedCount += 1;

      let emailSent = false;
      if (notifyCustomer && order.user?.email) {
        try {
          await sendEmail({
            to: order.user.email,
            subject: `【発送のお知らせ】ご注文 ${order.orderNumber}`,
            text:
              `${order.user.displayName ?? 'お客'}様\n\n` +
              `ご注文 ${order.orderNumber} を発送いたしました。\n` +
              `お問い合わせ番号: ${trackingNumber}\n` +
              `配送業者: ヤマト運輸\n` +
              `\nご利用ありがとうございました。`,
          });
          emailSent = true;
          emailCount += 1;
        } catch (mailErr) {
          // メール失敗で発送自体は取り消さない (発送は成立済み)。
          // eslint-disable-next-line no-console
          console.error('[shipping.confirm] email failed', orderNumber, mailErr);
        }
      }

      results.push({ orderNumber, trackingNumber, status: 'shipped', emailSent });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[shipping.confirm] failed', orderNumber, err);
      results.push({
        orderNumber,
        trackingNumber,
        status: 'error',
        message: '発送処理に失敗しました',
      });
    }
  }

  await logAudit({
    userId: session.user.id,
    action: 'admin.order.shipping.bulk',
    resource: 'orders',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: {
      requested: byOrderNumber.size,
      shipped: shippedCount,
      emailed: emailCount,
      notifyCustomer,
    },
  });

  return NextResponse.json({
    shipped: shippedCount,
    emailed: emailCount,
    total: byOrderNumber.size,
    results,
  });
});
