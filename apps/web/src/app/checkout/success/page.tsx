import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/Card';
import { ClearCartOnMount } from '@/components/cart/ClearCartOnMount';

export const metadata: Metadata = { title: 'ご注文ありがとうございました' };

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <ClearCartOnMount />
      <Card>
        <CardBody className="text-center">
          <h1 className="mb-2 text-2xl font-bold text-slate-800">
            ご注文ありがとうございました
          </h1>
          {order && (
            <p className="mb-4 font-mono text-sm text-slate-500">注文番号: {order}</p>
          )}
          <p className="mb-6 text-sm text-slate-600">
            決済が完了次第、確認メールをお送りします。
            <br />
            注文内容はマイページからもご確認いただけます。
          </p>
          <div className="flex justify-center gap-3">
            <Link
              href="/me"
              className="rounded-md bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              マイページ
            </Link>
            <Link
              href="/products"
              className="rounded-md border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              買い物を続ける
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
