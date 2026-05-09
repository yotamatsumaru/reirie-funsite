'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { useCartStore } from '@/stores/cart-store';
import { toast } from '@/stores/ui-store';
import { formatJpy } from '@/lib/pricing';

interface VariantInfo {
  id: string;
  name: string;
  optionColor: string | null;
  optionSize: string | null;
  effectivePrice: number;
  stockQuantity: number;
}

export function AddToCartForm({
  variants,
  loggedIn,
}: {
  variants: VariantInfo[];
  loggedIn: boolean;
}) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);

  const selected = variants.find((v) => v.id === variantId);
  const inStock = selected ? selected.stockQuantity > 0 : false;

  const onAdd = async () => {
    if (!loggedIn) {
      router.push('/signin?callbackUrl=' + encodeURIComponent(window.location.pathname));
      return;
    }
    if (!variantId) return;
    setLoading(true);
    try {
      await addItem(variantId, quantity);
      toast.success('カートに追加しました');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (variants.length === 0) {
    return <p className="text-sm text-slate-500">バリエーションが設定されていません</p>;
  }

  return (
    <div className="space-y-4">
      <Select
        label="バリエーション"
        value={variantId}
        onChange={(e) => setVariantId(e.target.value)}
      >
        {variants.map((v) => (
          <option key={v.id} value={v.id} disabled={v.stockQuantity === 0}>
            {v.name}
            {v.optionColor ? ` / ${v.optionColor}` : ''}
            {v.optionSize ? ` / ${v.optionSize}` : ''}
            {' - '}
            {formatJpy(v.effectivePrice)}
            {v.stockQuantity === 0 ? ' (在庫切れ)' : ''}
          </option>
        ))}
      </Select>

      {selected && (
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-brand-600">
            {formatJpy(selected.effectivePrice)}
          </span>
          <span className="text-xs text-slate-500">税込</span>
          {selected.stockQuantity > 0 ? (
            <span className="ml-auto text-xs text-emerald-600">在庫あり</span>
          ) : (
            <span className="ml-auto text-xs text-rose-600">在庫切れ</span>
          )}
        </div>
      )}

      <Select
        label="数量"
        value={quantity}
        onChange={(e) => setQuantity(Number(e.target.value))}
      >
        {Array.from({ length: Math.min(10, selected?.stockQuantity ?? 1) }).map((_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}
          </option>
        ))}
      </Select>

      <Button
        onClick={onAdd}
        loading={loading}
        disabled={!inStock}
        size="lg"
        className="w-full"
      >
        {inStock ? 'カートに追加' : '在庫切れ'}
      </Button>
    </div>
  );
}
