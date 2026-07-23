/**
 * /me/rewards/buy/success — Pui 購入完了 (Stripe Checkout からのリダイレクト先)
 *
 * 実際の Pui 付与は Stripe Webhook (checkout.session.completed) 側の
 * grantPuiFromStripePurchase() で確定するため、
 * このページ表示時点では反映が数秒遅れる場合がある旨を案内する。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { Card, CardBody } from '@/components/ui/Card';

export const metadata: Metadata = { title: 'ご購入ありがとうございました' };
export const dynamic = 'force-dynamic';

export default async function BuyRewardPointsSuccessPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/rewards');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { pui: true },
  });
  const balance = user?.pui ?? 0;

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card>
        <CardBody className="text-center">
          <h1 className="mb-2 text-2xl font-bold text-slate-800">
            ご購入ありがとうございました
          </h1>
          <p className="mb-6 text-sm text-slate-600">
            決済が完了しました。Pui は通常すぐに反映されますが、
            <br />
            反映まで数分かかる場合があります。
          </p>
          <p className="mb-6 text-sm text-slate-500">
            現在の保有 Pui：
            <span className="ml-1 text-lg font-bold text-slate-900">
              {balance.toLocaleString()} Pui
            </span>
          </p>
          <div className="flex justify-center gap-3">
            <Link
              href="/me/rewards"
              className="rounded-md bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              景品カタログへ
            </Link>
            <Link
              href="/me/points"
              className="rounded-md border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ポイント履歴へ
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
