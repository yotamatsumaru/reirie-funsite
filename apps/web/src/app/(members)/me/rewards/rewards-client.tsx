'use client';

/**
 * 景品カタログの閲覧・交換申請 UI
 *  - GOODS (発送必要) は発送先フォームを表示 (デフォルトは会員登録住所)
 *  - CALL_PRIORITY / DIGITAL は確認のみで即時交換
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  REWARD_CATALOG_ITEM_KIND_LABELS,
  requiresShipping,
  type RewardCatalogItemKindLiteral,
} from '@idol/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

type CatalogItem = {
  id: string;
  slug: string;
  kind: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  puiCost: number;
  stock: number | null;
};

type ShippingInfo = {
  shippingName: string;
  shippingPhone: string;
  shippingPostalCode: string;
  shippingPrefecture: string;
  shippingAddress1: string;
  shippingAddress2: string;
};

export function RewardsClient({
  items,
  balance,
  defaultShipping,
  onRedeemed,
}: {
  items: CatalogItem[];
  balance: number;
  defaultShipping: ShippingInfo;
  onRedeemed?: (kind: string) => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [shipping, setShipping] = useState<ShippingInfo>(defaultShipping);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function openRedeem(item: CatalogItem) {
    setSelected(item);
    setError(null);
    setSuccessMessage(null);
  }

  function closeModal() {
    setSelected(null);
    setError(null);
  }

  async function confirmRedeem() {
    if (!selected) return;
    const needsShipping = requiresShipping(selected.kind as RewardCatalogItemKindLiteral);
    if (needsShipping && (!shipping.shippingName || !shipping.shippingAddress1)) {
      setError('お名前と住所を入力してください');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/me/reward-redemptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          catalogItemId: selected.id,
          ...(needsShipping ? shipping : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '交換に失敗しました');
      }
      setSuccessMessage(
        selected.kind === 'DIGITAL'
          ? `${selected.name} と交換しました！下の「交換済みデジタル特典」からダウンロードできます。`
          : `${selected.name} との交換を受け付けました！`,
      );
      onRedeemed?.(selected.kind);
      setSelected(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {successMessage && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {successMessage}
        </p>
      )}

      {items.length === 0 ? (
        <Card>
          <CardBody className="text-center text-sm text-slate-500">
            現在交換できる景品はありません。
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {items.map((item) => {
            const outOfStock = item.stock !== null && item.stock <= 0;
            const affordable = balance >= item.puiCost;
            return (
              <Card key={item.id} className="flex h-full flex-col overflow-hidden">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="h-40 w-full object-cover"
                  />
                )}
                <CardBody className="flex flex-1 flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <Badge tone="info">
                      {REWARD_CATALOG_ITEM_KIND_LABELS[item.kind as RewardCatalogItemKindLiteral]}
                    </Badge>
                    {outOfStock && <Badge tone="danger">在庫切れ</Badge>}
                  </div>
                  <p className="font-semibold text-slate-800">{item.name}</p>
                  {item.description && (
                    <p className="line-clamp-3 flex-1 text-xs text-slate-500">
                      {item.description}
                    </p>
                  )}
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <p className="text-lg font-bold text-slate-900">
                      {item.puiCost.toLocaleString()} Pui
                    </p>
                    <Button
                      size="sm"
                      disabled={outOfStock || !affordable}
                      onClick={() => openRedeem(item)}
                    >
                      {outOfStock ? '在庫切れ' : affordable ? '交換する' : 'Pui 不足'}
                    </Button>
                  </div>
                  {item.stock !== null && !outOfStock && (
                    <p className="text-right text-[11px] text-slate-400">残り {item.stock} 点</p>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardBody className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">{selected.name} と交換</h2>
              <p className="text-sm text-slate-600">
                {selected.puiCost.toLocaleString()} Pui を消費します。よろしいですか？
              </p>

              {requiresShipping(selected.kind as RewardCatalogItemKindLiteral) && (
                <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-600">発送先情報</p>
                  <Input
                    label="お名前"
                    value={shipping.shippingName}
                    onChange={(e) =>
                      setShipping((s) => ({ ...s, shippingName: e.target.value }))
                    }
                    required
                  />
                  <Input
                    label="電話番号"
                    value={shipping.shippingPhone}
                    onChange={(e) =>
                      setShipping((s) => ({ ...s, shippingPhone: e.target.value }))
                    }
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      label="郵便番号"
                      value={shipping.shippingPostalCode}
                      onChange={(e) =>
                        setShipping((s) => ({ ...s, shippingPostalCode: e.target.value }))
                      }
                    />
                    <Input
                      label="都道府県"
                      value={shipping.shippingPrefecture}
                      onChange={(e) =>
                        setShipping((s) => ({ ...s, shippingPrefecture: e.target.value }))
                      }
                    />
                  </div>
                  <Input
                    label="住所1"
                    value={shipping.shippingAddress1}
                    onChange={(e) =>
                      setShipping((s) => ({ ...s, shippingAddress1: e.target.value }))
                    }
                    required
                  />
                  <Input
                    label="住所2 (建物名など)"
                    value={shipping.shippingAddress2}
                    onChange={(e) =>
                      setShipping((s) => ({ ...s, shippingAddress2: e.target.value }))
                    }
                  />
                </div>
              )}

              {error && (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeModal} disabled={busy}>
                  キャンセル
                </Button>
                <Button type="button" loading={busy} onClick={confirmRedeem}>
                  交換を確定する
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
