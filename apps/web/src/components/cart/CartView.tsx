'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useCartStore } from '@/stores/cart-store';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/stores/ui-store';
import { formatJpy } from '@/lib/pricing';

export function CartView() {
  const { data: session, status } = useSession();
  const { items, totals, loading, fetchCart, updateItem, removeItem } = useCartStore();

  useEffect(() => {
    if (status === 'authenticated') fetchCart();
  }, [status, fetchCart]);

  if (status === 'loading') return <Spinner />;

  if (status === 'unauthenticated') {
    return (
      <Card>
        <CardBody className="text-center">
          <p className="mb-4 text-sm text-slate-600">カートを使うにはログインが必要です</p>
          <Link
            href="/signin?callbackUrl=/cart"
            className="inline-block rounded-md bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            ログイン
          </Link>
        </CardBody>
      </Card>
    );
  }

  if (loading && items.length === 0) return <Spinner />;

  if (items.length === 0) {
    return (
      <Card>
        <CardBody className="text-center">
          <p className="mb-4 text-sm text-slate-600">カートは空です</p>
          <Link
            href="/products"
            className="inline-block rounded-md bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            グッズを見る
          </Link>
        </CardBody>
      </Card>
    );
  }

  const hasBlocked = items.some((i) => i.blocked);

  return (
    <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {items.map((item) => (
          <Card key={item.id}>
            <CardBody className="flex gap-3 sm:gap-4">
              <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md bg-slate-100 sm:h-24 sm:w-24">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <Link
                  href={`/products/${item.productSlug}`}
                  className="line-clamp-2 text-sm font-semibold text-slate-800 hover:text-brand-600"
                >
                  {item.productName}
                </Link>
                <p className="truncate text-xs text-slate-500">{item.variantName}</p>
                {item.blocked && (
                  <Badge tone="danger" className="mt-1 self-start">
                    {item.blocked.reason === 'plan_required' ? 'プラン要件未達' : '購入不可'}
                  </Badge>
                )}
                {!item.blocked && !item.inStock && (
                  <Badge tone="warning" className="mt-1 self-start">
                    在庫不足 (残{item.available})
                  </Badge>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 sm:mt-auto">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-500">数量</label>
                    <select
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                      value={item.quantity}
                      onChange={async (e) => {
                        try {
                          await updateItem(item.id, Number(e.target.value));
                        } catch (err) {
                          toast.error((err as Error).message);
                        }
                      }}
                    >
                      {Array.from({ length: Math.max(1, Math.min(10, item.available || 10)) }).map(
                        (_, i) => (
                          <option key={i + 1} value={i + 1}>
                            {i + 1}
                          </option>
                        ),
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await removeItem(item.id);
                          toast.info('カートから削除しました');
                        } catch (err) {
                          toast.error((err as Error).message);
                        }
                      }}
                      className="px-2 py-1 text-xs text-rose-600 hover:underline"
                    >
                      削除
                    </button>
                  </div>
                  <p className="ml-auto text-sm font-semibold text-slate-800">
                    {formatJpy(item.subtotal)}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardBody className="space-y-2 text-sm">
          <Row label="小計" value={formatJpy(totals.subtotal)} />
          <Row label="消費税" value={formatJpy(totals.taxAmount)} />
          <Row label="送料" value={formatJpy(totals.shippingFee)} />
          <hr className="my-2" />
          <Row label="合計" value={formatJpy(totals.totalAmount)} bold />
          <Link
            href="/checkout"
            aria-disabled={hasBlocked}
            className={`mt-4 block rounded-md px-4 py-3 text-center text-base font-semibold ${
              hasBlocked
                ? 'pointer-events-none bg-slate-200 text-slate-400'
                : 'bg-brand-600 text-white hover:bg-brand-700'
            }`}
          >
            購入手続きへ
          </Link>
          {hasBlocked && (
            <p className="text-xs text-rose-600">購入できない商品があります。削除してください。</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? 'text-base font-bold' : ''}`}>
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-800">{value}</span>
    </div>
  );
}
