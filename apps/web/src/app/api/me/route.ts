import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { UpdateProfileSchema, WithdrawAccountSchema } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { requireApiSession } from '@/lib/api-auth';
import { verifyPassword } from '@/lib/password';
import { env } from '@/lib/env';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
      ticketLinks: true,
    },
  });
  if (!user) throw errors.notFound();
  return NextResponse.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    fullName: user.fullName,
    furigana: user.furigana,
    phone: user.phone,
    birthDate: user.birthDate,
    postalCode: user.postalCode,
    prefecture: user.prefecture,
    addressLine1: user.addressLine1,
    addressLine2: user.addressLine2,
    avatarUrl: user.avatarUrl,
    plan: session.user.plan,
    role: user.role,
    marketingOptIn: user.marketingOptIn,
    subscription: user.subscriptions[0] ?? null,
    ticketLink: user.ticketLinks[0] ?? null,
    createdAt: user.createdAt,
  });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = await req.json();
  const input = UpdateProfileSchema.parse(body);
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...input,
      birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
    },
  });
  await logAudit({ userId: session.user.id, action: 'user.profile.update' });
  return NextResponse.json({ message: '更新しました' });
});

/**
 * DELETE /api/me — 退会 (自己アカウント削除)
 *
 * 誤操作防止のため、現在のパスワードの再入力を必須とする。
 * 有効なサブスクリプションがある場合は、退会と同時に Stripe 側も
 * 即時キャンセルする (キャンセル忘れによる課金継続を防ぐため)。
 * アカウント自体はソフトデリート (deletedAt) とし、ログイン不可にする。
 */
export const DELETE = handle(async (req: Request) => {
  const session = await requireApiSession(req);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = WithdrawAccountSchema.parse(body);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      subscriptions: {
        where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!user) throw errors.notFound();

  // デモモードではパスワード検証をスキップする (auth.ts / credentials.ts と同様)
  if (!env.demoMode) {
    if (!verifyPassword(input.password, user.passwordHash)) {
      throw errors.badRequest('パスワードが正しくありません');
    }
  }

  // 有効なサブスクリプションがあれば Stripe 側も即時キャンセルする。
  // (Stripe 側の失敗で退会自体をブロックしないよう、失敗はログのみに留める。
  //  実際の DB 上のステータス反映は webhook (customer.subscription.deleted) で行われる)
  if (!env.demoMode && user.subscriptions.length > 0) {
    try {
      const stripe = await getStripe();
      await Promise.all(
        user.subscriptions.map((sub) =>
          stripe.subscriptions.cancel(sub.stripeSubscriptionId).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[me.withdraw] stripe subscription cancel failed', sub.id, err);
          }),
        ),
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[me.withdraw] stripe cancel failed', err);
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { deletedAt: new Date() },
  });
  await logAudit({ userId: session.user.id, action: 'user.delete' });
  return NextResponse.json({ message: '退会処理を受け付けました' });
});

