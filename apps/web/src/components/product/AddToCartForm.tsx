'use client';

/**
 * AddToCartForm — 商品のバリエーション選択 + カート追加
 *
 * 【なぜ作り直したか】
 * 以前は全バリエーションを 1 つのプルダウンに詰め込んでいた:
 *
 *   「ホワイト / ホワイト / S - ¥3,500」
 *   「ホワイト / ホワイト / M - ¥3,500 (在庫切れ)」
 *   ...
 *
 * Tシャツのようにカラー x サイズがあると組み合わせの数だけ行が並び、
 *   - 自分が今どのサイズを選んでいるのか分かりにくい
 *   - サイズだけ変えたいのに全部読み直す必要がある
 *   - スマホでは特に選びづらい
 * という問題があった。
 *
 * そこで «カラー» と «サイズ» を別々のボタン列に分け、
 * 選択中が一目で分かるようにした。サイズは S→M→L→XL の順に整列する
 * (登録順のままだと「L, M, S, XL」のような直感に反する並びになる)。
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { useCartStore } from '@/stores/cart-store';
import { toast } from '@/stores/ui-store';
import { formatJpy } from '@/lib/pricing';
import {
  buildVariantLabel,
  hasColorOptions,
  hasSizeOptions,
  sortBySize,
} from '@idol/shared';

interface VariantInfo {
  id: string;
  name: string;
  optionColor: string | null;
  optionSize: string | null;
  effectivePrice: number;
  stockQuantity: number;
}

/** 重複を除いた順序付きリスト */
function uniq(values: (string | null)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v == null || v.trim() === '') continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
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
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);

  // サイズ順に整列しておく (S → M → L → XL)
  const ordered = useMemo(() => sortBySize(variants), [variants]);

  const showColor = useMemo(() => hasColorOptions(variants), [variants]);
  const showSize = useMemo(() => hasSizeOptions(variants), [variants]);

  const colors = useMemo(() => uniq(ordered.map((v) => v.optionColor)), [ordered]);
  const sizes = useMemo(() => uniq(ordered.map((v) => v.optionSize)), [ordered]);

  /** 初期選択: 在庫のあるものを優先する (いきなり「在庫切れ」だと購入意欲を削ぐ) */
  const initial = useMemo(
    () => ordered.find((v) => v.stockQuantity > 0) ?? ordered[0],
    [ordered],
  );

  const [color, setColor] = useState<string | null>(initial?.optionColor ?? null);
  const [size, setSize] = useState<string | null>(initial?.optionSize ?? null);

  /** 現在の選択に一致するバリエーション */
  const selected = useMemo(() => {
    return (
      ordered.find(
        (v) =>
          (!showColor || v.optionColor === color) && (!showSize || v.optionSize === size),
      ) ??
      // カラー/サイズを持たない商品は先頭
      (!showColor && !showSize ? ordered[0] : undefined)
    );
  }, [ordered, showColor, showSize, color, size]);

  /**
   * そのサイズが「選んだカラーで」在庫があるか。
   * 在庫が無いサイズを押せてしまうと、選んだ後に「在庫切れ」と言われることになる。
   */
  const sizeStock = (s: string): number => {
    const v = ordered.find(
      (x) => (!showColor || x.optionColor === color) && x.optionSize === s,
    );
    return v?.stockQuantity ?? 0;
  };

  const colorStock = (c: string): number => {
    const list = ordered.filter((x) => x.optionColor === c);
    return list.reduce((sum, x) => sum + x.stockQuantity, 0);
  };

  const inStock = selected ? selected.stockQuantity > 0 : false;
  const maxQty = Math.max(1, Math.min(10, selected?.stockQuantity ?? 1));

  const onAdd = async () => {
    if (!loggedIn) {
      router.push('/signin?callbackUrl=' + encodeURIComponent(window.location.pathname));
      return;
    }
    if (!selected) return;
    setLoading(true);
    try {
      await addItem(selected.id, Math.min(quantity, maxQty));
      toast.success(`カートに追加しました（${buildVariantLabel(selected)}）`);
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
      {/* --- カラー選択 --- */}
      {showColor && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">
            カラー
            {color && <span className="ml-2 text-slate-500">{color}</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const soldOut = colorStock(c) === 0;
              const active = c === color;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={active}
                  disabled={soldOut}
                  onClick={() => {
                    setColor(c);
                    // カラーを変えたとき、そのカラーに無いサイズを選んだままにしない
                    const stillOk = ordered.some(
                      (v) => v.optionColor === c && v.optionSize === size,
                    );
                    if (!stillOk) {
                      const firstAvailable =
                        ordered.find((v) => v.optionColor === c && v.stockQuantity > 0) ??
                        ordered.find((v) => v.optionColor === c);
                      setSize(firstAvailable?.optionSize ?? null);
                    }
                    setQuantity(1);
                  }}
                  className={[
                    'rounded-lg border px-4 py-2 text-sm transition-colors',
                    active
                      ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700'
                      : 'border-slate-300 text-slate-700 hover:border-slate-400',
                    soldOut ? 'cursor-not-allowed text-slate-400 line-through' : '',
                  ].join(' ')}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* --- サイズ選択 --- */}
      {showSize && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">
            サイズ
            {size && <span className="ml-2 text-slate-500">{size}</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {sizes.map((s) => {
              const stock = sizeStock(s);
              const soldOut = stock === 0;
              const active = s === size;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  disabled={soldOut}
                  title={soldOut ? 'このサイズは在庫切れです' : undefined}
                  onClick={() => {
                    setSize(s);
                    setQuantity(1);
                  }}
                  className={[
                    'min-w-[3.5rem] rounded-lg border px-4 py-2 text-sm transition-colors',
                    active
                      ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700'
                      : 'border-slate-300 text-slate-700 hover:border-slate-400',
                    soldOut ? 'cursor-not-allowed text-slate-400 line-through' : '',
                  ].join(' ')}
                >
                  {s}
                </button>
              );
            })}
          </div>
          {/* 在庫切れのサイズがあることを明示する */}
          {sizes.some((s) => sizeStock(s) === 0) && (
            <p className="mt-1.5 text-xs text-slate-500">
              取り消し線のサイズは在庫切れです
            </p>
          )}
        </div>
      )}

      {/* --- サイズもカラーも無い商品は従来どおりプルダウン --- */}
      {!showColor && !showSize && ordered.length > 1 && (
        <Select
          label="種類"
          value={selected?.id ?? ''}
          onChange={(e) => {
            const v = ordered.find((x) => x.id === e.target.value);
            if (v) {
              setColor(v.optionColor);
              setSize(v.optionSize);
            }
          }}
        >
          {ordered.map((v) => (
            <option key={v.id} value={v.id} disabled={v.stockQuantity === 0}>
              {buildVariantLabel(v)} - {formatJpy(v.effectivePrice)}
              {v.stockQuantity === 0 ? '（在庫切れ）' : ''}
            </option>
          ))}
        </Select>
      )}

      {/* --- 価格・在庫 --- */}
      {selected && (
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-brand-600">
            {formatJpy(selected.effectivePrice)}
          </span>
          <span className="text-xs text-slate-500">税込</span>
          {selected.stockQuantity > 0 ? (
            <span className="ml-auto text-xs text-emerald-600">
              在庫あり
              {selected.stockQuantity <= 3 && (
                <span className="ml-1 text-amber-600">
                  （残り{selected.stockQuantity}点）
                </span>
              )}
            </span>
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
        {Array.from({ length: maxQty }).map((_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}
          </option>
        ))}
      </Select>

      {/* デスクトップ: インラインボタン */}
      <Button
        onClick={onAdd}
        loading={loading}
        disabled={!inStock}
        size="lg"
        className="hidden w-full sm:block"
      >
        {inStock ? 'カートに追加' : '在庫切れ'}
      </Button>

      {/* モバイル: 画面下部に固定 */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur safe-bottom sm:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          {selected && (
            <div className="flex flex-col leading-tight">
              <span className="text-base font-bold text-brand-600">
                {formatJpy(selected.effectivePrice)}
              </span>
              {/* 選択中のサイズをボタンの隣に出す。
                  スマホは選択部分が画面外に出やすく «何を買うのか» を見失うため */}
              <span className="text-[10px] text-slate-500">
                {buildVariantLabel(selected) || '　'}
                {selected.stockQuantity > 0 ? '' : '（在庫切れ）'}
              </span>
            </div>
          )}
          <Button
            onClick={onAdd}
            loading={loading}
            disabled={!inStock}
            size="lg"
            className="ml-auto flex-1"
          >
            {inStock ? 'カートに追加' : '在庫切れ'}
          </Button>
        </div>
      </div>
      {/* モバイル: スティッキーボタン分の余白 */}
      <div className="h-20 sm:hidden" aria-hidden="true" />
    </div>
  );
}
