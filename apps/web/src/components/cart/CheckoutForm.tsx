'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCartStore } from '@/stores/cart-store';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/stores/ui-store';
import { formatJpy } from '@/lib/pricing';

const PREFS = [
  '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県',
  '埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県',
  '岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
  '鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県',
  '佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
];

export function CheckoutForm() {
  const router = useRouter();
  const { status } = useSession();
  const { items, totals, fetchCart } = useCartStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    phone: '',
    postalCode: '',
    prefecture: '東京都',
    addressLine1: '',
    addressLine2: '',
    notes: '',
  });

  useEffect(() => {
    if (status === 'authenticated') fetchCart();
  }, [status, fetchCart]);

  if (status === 'loading') return <Spinner />;

  if (items.length === 0) {
    return (
      <Card>
        <CardBody className="text-center text-sm text-slate-500">
          カートが空です
        </CardBody>
      </Card>
    );
  }

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const origin = window.location.origin;
      const res = await fetch('/api/orders/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          shipping: {
            name: form.name,
            phone: form.phone,
            postalCode: form.postalCode,
            prefecture: form.prefecture,
            addressLine1: form.addressLine1,
            addressLine2: form.addressLine2 || undefined,
          },
          notes: form.notes || undefined,
          successUrl: `${origin}/checkout/success`,
          cancelUrl: `${origin}/cart`,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '注文確定に失敗しました');
      }
      const j = await res.json();
      if (j.checkoutUrl) {
        window.location.href = j.checkoutUrl;
      } else {
        router.push('/checkout/success');
      }
    } catch (e) {
      setError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold sm:text-lg">お届け先</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <Input
              label="お名前"
              name="name"
              required
              autoComplete="name"
              value={form.name}
              onChange={update('name')}
            />
            <Input
              label="電話番号"
              name="phone"
              required
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={form.phone}
              onChange={update('phone')}
              placeholder="090-1234-5678"
            />
            <Input
              label="郵便番号"
              name="postalCode"
              required
              autoComplete="postal-code"
              inputMode="numeric"
              value={form.postalCode}
              onChange={update('postalCode')}
              placeholder="123-4567"
              pattern="\d{3}-?\d{4}"
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">都道府県</label>
              <select
                value={form.prefecture}
                onChange={update('prefecture')}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {PREFS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <Input
              label="住所1 (市区町村・番地)"
              name="addressLine1"
              required
              autoComplete="address-line1"
              value={form.addressLine1}
              onChange={update('addressLine1')}
            />
            <Input
              label="住所2 (建物名・部屋番号)"
              name="addressLine2"
              autoComplete="address-line2"
              value={form.addressLine2}
              onChange={update('addressLine2')}
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">備考 (任意)</label>
              <textarea
                value={form.notes}
                onChange={update('notes')}
                maxLength={500}
                rows={3}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader>
          <h2 className="text-base font-semibold sm:text-lg">ご注文内容</h2>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          {items.map((i) => (
            <div key={i.id} className="flex justify-between text-xs">
              <span className="line-clamp-1">
                {i.productName} × {i.quantity}
              </span>
              <span>{formatJpy(i.subtotal)}</span>
            </div>
          ))}
          <hr className="my-2" />
          <Row label="小計" value={formatJpy(totals.subtotal)} />
          <Row label="消費税" value={formatJpy(totals.taxAmount)} />
          <Row label="送料" value={formatJpy(totals.shippingFee)} />
          <hr className="my-2" />
          <Row label="合計" value={formatJpy(totals.totalAmount)} bold />
          {error && <p className="rounded-md bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
          <Button type="submit" loading={loading} className="mt-3 w-full" size="lg">
            Stripe で決済する
          </Button>
          <p className="text-xs text-slate-500">
            決済画面に遷移します。確定後、Stripe からのリダイレクトで完了画面に戻ります。
          </p>
        </CardBody>
      </Card>
    </form>
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
