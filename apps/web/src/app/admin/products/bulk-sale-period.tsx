'use client';

/**
 * 商品一覧の「一斉発売設定」。
 *
 * 複数商品にチェックを入れ、発売開始日時 (JST) を 1 回入力するだけで
 * 全部まとめて予約できる。時刻になれば自動で購入可能になるので、
 * 運営が深夜に公開ボタンを押して回る必要がなくなる。
 *
 * 一覧 (サーバーコンポーネント) から商品配列を受け取り、
 * チェックボックス付きの表として描画する。
 */
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatJstDateTimeShort, getSaleStatus, SALE_STATUS_LABELS, validateSalePeriod } from '@idol/shared';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { formatJpy } from '@/lib/pricing';
import { fromDatetimeLocalJst } from '@/lib/video-edit';

export type AdminProductRow = {
  id: string;
  name: string;
  slug: string;
  categoryName: string | null;
  basePrice: number;
  stock: number;
  isActive: boolean;
  isPremiumExclusive: boolean;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  shippingMethodNames: string[];
  optionCount: number;
};

const STATUS_TONE: Record<string, 'gray' | 'success' | 'warning' | 'info'> = {
  HIDDEN: 'gray',
  UPCOMING: 'warning',
  ON_SALE: 'success',
  ENDED: 'gray',
};

export function AdminProductTable({ products }: { products: AdminProductRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [activate, setActivate] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const allSelected = products.length > 0 && selected.size === products.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = useMemo(
    () => products.map((p) => ({ ...p, status: getSaleStatus(p) })),
    [products],
  );

  function apply(clear: boolean) {
    setError(null);
    setSuccess(null);
    if (selected.size === 0) return setError('商品を 1 つ以上選択してください。');
    const saleStartsAt = clear ? null : fromDatetimeLocalJst(startLocal);
    const saleEndsAt = clear ? null : fromDatetimeLocalJst(endLocal);
    if (!clear && !saleStartsAt && !saleEndsAt) {
      return setError('発売開始日時または販売終了日時を入力してください。');
    }
    const invalid = validateSalePeriod(saleStartsAt, saleEndsAt);
    if (invalid) return setError(invalid);

    startTransition(async () => {
      const res = await fetch('/api/admin/products/bulk-sale-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: Array.from(selected),
          saleStartsAt,
          saleEndsAt,
          activate: clear ? false : activate,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(j.error?.message ?? `エラーが発生しました (HTTP ${res.status})`);
        return;
      }
      const j = (await res.json()) as { updated: number };
      setSuccess(
        clear
          ? `${j.updated} 件の販売期間をクリアしました。`
          : `${j.updated} 件に販売期間を設定しました${saleStartsAt ? `（発売: ${formatJstDateTimeShort(saleStartsAt)}）` : ''}。`,
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- 一斉発売設定パネル ---- */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">
              一斉発売設定
              <span className="ml-2 text-xs font-normal text-slate-500">
                選択中: {selected.size} 件
              </span>
            </h2>
            <p className="text-xs text-slate-500">
              商品にチェックを入れて発売日時を設定すると、その時刻に自動で購入可能になります（日本時間）。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              label="発売開始日時（JST）"
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
            <Input
              label="販売終了日時（JST・任意）"
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
            />
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={activate}
                  onChange={(e) => setActivate(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                />
                同時に「販売中」にする
              </label>
              <div className="flex gap-2">
                <Button size="sm" loading={pending} onClick={() => apply(false)} disabled={selected.size === 0}>
                  選択した商品に設定
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={pending}
                  onClick={() => apply(true)}
                  disabled={selected.size === 0}
                >
                  期間をクリア
                </Button>
              </div>
            </div>
          </div>
          {error && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
          {success && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {success}
            </p>
          )}
        </CardBody>
      </Card>

      {/* ---- モバイル: カードリスト ---- */}
      <div className="space-y-3 md:hidden">
        {rows.length === 0 ? (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">商品はありません</CardBody>
          </Card>
        ) : (
          rows.map((p) => (
            <Card key={p.id}>
              <CardBody className="space-y-2">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                    aria-label={`${p.name} を選択`}
                  />
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/products/${p.id}`} className="block font-semibold text-brand-600 hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-slate-400">{p.slug}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-slate-500">{p.categoryName ?? '-'}</span>
                  <span className="font-semibold text-slate-800">{formatJpy(p.basePrice)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge tone={STATUS_TONE[p.status] ?? 'gray'}>{SALE_STATUS_LABELS[p.status]}</Badge>
                  {p.isPremiumExclusive && <Badge tone="brand">PREMIUM</Badge>}
                  <Badge tone={p.stock <= 5 ? 'warning' : 'gray'}>在庫 {p.stock}</Badge>
                  {p.optionCount > 0 && <Badge tone="info">オプション {p.optionCount}</Badge>}
                </div>
                {(p.saleStartsAt || p.saleEndsAt) && (
                  <p className="text-[11px] text-slate-500">
                    {p.saleStartsAt && <>発売 {formatJstDateTimeShort(p.saleStartsAt)}</>}
                    {p.saleStartsAt && p.saleEndsAt && ' 〜 '}
                    {p.saleEndsAt && <>終了 {formatJstDateTimeShort(p.saleEndsAt)}</>}
                  </p>
                )}
                <p className="text-[11px] text-slate-500">
                  配送: {p.shippingMethodNames.length > 0 ? p.shippingMethodNames.join(' / ') : '基本配送'}
                </p>
              </CardBody>
            </Card>
          ))
        )}
      </div>

      {/* ---- デスクトップ: テーブル ---- */}
      <Card className="hidden md:block">
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                    aria-label="すべて選択"
                  />
                </th>
                <th className="px-4 py-3">商品名</th>
                <th className="px-4 py-3">カテゴリ</th>
                <th className="px-4 py-3">価格</th>
                <th className="px-4 py-3">在庫</th>
                <th className="px-4 py-3">状態 / 販売期間</th>
                <th className="px-4 py-3">配送方法</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id} className={`hover:bg-slate-50 ${selected.has(p.id) ? 'bg-brand-50/40' : ''}`}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                      aria-label={`${p.name} を選択`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/products/${p.id}`} className="text-brand-600 hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-slate-400">{p.slug}</p>
                    {p.optionCount > 0 && (
                      <Badge tone="info" className="mt-1">
                        購入時入力 {p.optionCount} 項目
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">{p.categoryName ?? '-'}</td>
                  <td className="px-4 py-3">{formatJpy(p.basePrice)}</td>
                  <td className="px-4 py-3">
                    {p.stock <= 5 ? <Badge tone="warning">{p.stock}</Badge> : p.stock}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[p.status] ?? 'gray'}>{SALE_STATUS_LABELS[p.status]}</Badge>
                    {p.isPremiumExclusive && (
                      <Badge tone="brand" className="ml-1">
                        PREMIUM
                      </Badge>
                    )}
                    {(p.saleStartsAt || p.saleEndsAt) && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        {p.saleStartsAt && <>発売 {formatJstDateTimeShort(p.saleStartsAt)}</>}
                        {p.saleStartsAt && p.saleEndsAt && <br />}
                        {p.saleEndsAt && <>終了 {formatJstDateTimeShort(p.saleEndsAt)}</>}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {p.shippingMethodNames.length > 0 ? p.shippingMethodNames.join(' / ') : (
                      <span className="text-slate-400">基本配送</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    商品はありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
