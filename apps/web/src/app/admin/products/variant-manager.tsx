'use client';

/**
 * 商品詳細ページの「バリエーション（在庫）」管理。
 *  - 既存バリエーションの一覧表示 + 在庫数の更新
 *  - 新規バリエーションの追加（POST /api/admin/products/[id]/variants）
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export type VariantItem = {
  id: string;
  sku: string;
  name: string;
  optionColor: string | null;
  optionSize: string | null;
  priceDelta: number;
  isActive: boolean;
  quantity: number;
  reserved: number;
  safetyStock: number;
};

export function VariantManager({
  productId,
  variants,
}: {
  productId: string;
  variants: VariantItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(variants.length === 0);

  // 新規バリエーション入力
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [optionColor, setOptionColor] = useState('');
  const [optionSize, setOptionSize] = useState('');
  const [priceDelta, setPriceDelta] = useState('0');
  const [initialQuantity, setInitialQuantity] = useState('0');
  const [safetyStock, setSafetyStock] = useState('0');

  function resetForm() {
    setSku('');
    setName('');
    setOptionColor('');
    setOptionSize('');
    setPriceDelta('0');
    setInitialQuantity('0');
    setSafetyStock('0');
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!sku.trim() || !name.trim()) {
      setError('SKU とバリエーション名は必須です。');
      return;
    }
    const payload = {
      sku: sku.trim(),
      name: name.trim(),
      optionColor: optionColor.trim() || undefined,
      optionSize: optionSize.trim() || undefined,
      priceDelta: Number(priceDelta) || 0,
      initialQuantity: Number(initialQuantity) || 0,
      safetyStock: Number(safetyStock) || 0,
      isActive: true,
    };
    startTransition(async () => {
      const res = await fetch(`/api/admin/products/${productId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(j.error?.message ?? `エラーが発生しました (HTTP ${res.status})`);
        return;
      }
      resetForm();
      setShowForm(false);
      router.refresh();
    });
  }

  function updateStock(variantId: string, quantity: number, safety: number) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/inventories/${variantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity, safetyStock: safety }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(j.error?.message ?? `在庫更新に失敗しました (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">
            バリエーション・在庫（{variants.length} 件）
          </h2>
          <Button
            type="button"
            size="sm"
            variant={showForm ? 'ghost' : 'outline'}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? '閉じる' : '+ バリエーション追加'}
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {variants.length === 0 ? (
          <p className="text-sm text-slate-500">
            まだバリエーションがありません。サイズ・カラーなどを1件以上追加すると、ショップで購入できるようになります。
          </p>
        ) : (
          <div className="space-y-3">
            {variants.map((v) => (
              <VariantRow
                key={v.id}
                variant={v}
                pending={pending}
                onUpdateStock={updateStock}
              />
            ))}
          </div>
        )}

        {showForm && (
          <form
            onSubmit={handleAdd}
            className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4"
          >
            <p className="text-sm font-semibold text-slate-700">新しいバリエーションを追加</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="SKU（在庫管理コード・重複不可）"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="TSHIRT-2026-M-BLK"
                required
              />
              <Input
                label="バリエーション名"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mサイズ / ブラック"
                required
              />
              <Input
                label="カラー（任意）"
                value={optionColor}
                onChange={(e) => setOptionColor(e.target.value)}
                placeholder="ブラック"
              />
              <Input
                label="サイズ（任意）"
                value={optionSize}
                onChange={(e) => setOptionSize(e.target.value)}
                placeholder="M"
              />
              <Input
                label="価格差（円・基本価格に加算）"
                type="number"
                value={priceDelta}
                onChange={(e) => setPriceDelta(e.target.value)}
              />
              <Input
                label="初期在庫数"
                type="number"
                min={0}
                value={initialQuantity}
                onChange={(e) => setInitialQuantity(e.target.value)}
              />
              <Input
                label="安全在庫（この数以下で警告）"
                type="number"
                min={0}
                value={safetyStock}
                onChange={(e) => setSafetyStock(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" loading={pending}>
              バリエーションを追加
            </Button>
          </form>
        )}

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function VariantRow({
  variant,
  pending,
  onUpdateStock,
}: {
  variant: VariantItem;
  pending: boolean;
  onUpdateStock: (variantId: string, quantity: number, safety: number) => void;
}) {
  const [quantity, setQuantity] = useState(String(variant.quantity));
  const [safety, setSafety] = useState(String(variant.safetyStock));
  const available = variant.quantity - variant.reserved;
  const dirty =
    Number(quantity) !== variant.quantity || Number(safety) !== variant.safetyStock;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="min-w-[160px] flex-1">
        <p className="font-medium text-slate-800">{variant.name}</p>
        <p className="text-xs text-slate-400">{variant.sku}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {variant.optionColor && <Badge tone="gray">{variant.optionColor}</Badge>}
          {variant.optionSize && <Badge tone="gray">{variant.optionSize}</Badge>}
          {variant.priceDelta !== 0 && (
            <Badge tone="brand">
              {variant.priceDelta > 0 ? '+' : ''}
              {variant.priceDelta}円
            </Badge>
          )}
          <Badge tone={available <= variant.safetyStock ? 'warning' : 'success'}>
            販売可能 {available}
          </Badge>
          {variant.reserved > 0 && <Badge tone="gray">予約 {variant.reserved}</Badge>}
        </div>
      </div>
      <div className="w-24">
        <Input
          label="在庫数"
          type="number"
          min={0}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </div>
      <div className="w-24">
        <Input
          label="安全在庫"
          type="number"
          min={0}
          value={safety}
          onChange={(e) => setSafety(e.target.value)}
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || !dirty}
        onClick={() => onUpdateStock(variant.id, Number(quantity), Number(safety))}
      >
        在庫を更新
      </Button>
    </div>
  );
}
