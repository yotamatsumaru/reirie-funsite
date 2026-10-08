'use client';

/**
 * ShippingSelector — カート / 購入手続きで配送方法を選ぶ UI
 *
 * BASE の「送料詳細設定 App」と同様に、カート内の全商品が対応している
 * 配送方法 (ネコポス / 宅急便コンパクト / 宅急便 …) だけを候補として出し、
 * 購入者が 1 つ選ぶ。選ぶとサーバーで送料を再計算して合計に反映する。
 *
 *  - 候補が 1 つだけなら選択 UI は出さず、名前と送料だけ表示する
 *  - 候補が無い (= 配送方法マスタが空) 場合は従来の一律送料なので何も出さない
 *  - 送料無料閾値に達していれば「送料無料」の案内を出す
 */
import { useCartStore } from '@/stores/cart-store';
import { toast } from '@/stores/ui-store';
import { formatJpy } from '@/lib/pricing';

export function ShippingSelector({ compact = false }: { compact?: boolean }) {
  const { shipping, totals, selectShipping, loading } = useCartStore();
  const { candidates, selectedId, freeShippingThreshold } = shipping;

  if (candidates.length === 0) return null;

  const isFree = totals.shippingFee === 0;
  const remainingForFree =
    freeShippingThreshold > 0 && totals.subtotal < freeShippingThreshold
      ? freeShippingThreshold - totals.subtotal
      : 0;

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <p className="text-sm font-medium text-slate-700">配送方法</p>
      {candidates.length === 1 ? (
        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-700">{candidates[0]!.name}</span>
          <span className="font-semibold text-slate-800">
            {isFree ? '無料' : formatJpy(candidates[0]!.fee)}
          </span>
        </div>
      ) : (
        <div className="space-y-1.5" role="radiogroup" aria-label="配送方法">
          {candidates.map((m) => {
            const active = m.id === selectedId;
            return (
              <label
                key={m.id}
                className={[
                  'flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-brand-500 bg-brand-50 text-brand-800'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                  loading ? 'opacity-70' : '',
                ].join(' ')}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="shippingMethod"
                    value={m.id}
                    checked={active}
                    disabled={loading}
                    onChange={async () => {
                      try {
                        await selectShipping(m.id);
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                    className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-400"
                  />
                  <span className="flex flex-col leading-tight">
                    <span className="font-medium">{m.name}</span>
                    {m.description && (
                      <span className="text-[11px] text-slate-500">{m.description}</span>
                    )}
                  </span>
                </span>
                <span className="font-semibold">
                  {isFree ? '無料' : formatJpy(m.fee)}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {isFree && freeShippingThreshold === 0 && (
        <p className="text-xs text-emerald-600">プレミアム会員特典で送料無料です</p>
      )}
      {isFree && freeShippingThreshold > 0 && (
        <p className="text-xs text-emerald-600">
          {formatJpy(freeShippingThreshold)} 以上のご購入で送料無料です
        </p>
      )}
      {!isFree && remainingForFree > 0 && (
        <p className="text-xs text-slate-500">
          あと {formatJpy(remainingForFree)} で送料無料になります
        </p>
      )}
    </div>
  );
}
