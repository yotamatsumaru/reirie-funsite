'use client';

/**
 * 配送方法一覧 + 追加 / 編集 / 削除 (管理画面)
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { B2_INVOICE_TYPES } from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';

export type ShippingMethodRow = {
  id: string;
  name: string;
  description: string | null;
  fee: number;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  b2InvoiceType: string | null;
  productCount: number;
};

type Draft = {
  name: string;
  description: string;
  fee: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: string;
  b2InvoiceType: string;
};

const emptyDraft: Draft = {
  name: '',
  description: '全国一律送料',
  fee: '',
  isDefault: false,
  isActive: true,
  sortOrder: '0',
  b2InvoiceType: '0',
};

/** よく使うヤマトの配送方法をワンクリックで入力できるプリセット */
const PRESETS: Array<Pick<Draft, 'name' | 'fee' | 'b2InvoiceType'>> = [
  { name: 'ネコポス', fee: '600', b2InvoiceType: '7' },
  { name: '宅急便コンパクト', fee: '800', b2InvoiceType: '8' },
  { name: 'ヤマト宅急便', fee: '1000', b2InvoiceType: '0' },
  { name: 'クリックポスト', fee: '400', b2InvoiceType: '' },
];

function toPayload(d: Draft) {
  return {
    name: d.name.trim(),
    description: d.description.trim() || null,
    fee: Math.max(0, Number(d.fee) || 0),
    isDefault: d.isDefault,
    isActive: d.isActive,
    sortOrder: Math.max(0, Number(d.sortOrder) || 0),
    b2InvoiceType: d.b2InvoiceType || null,
  };
}

function fromRow(m: ShippingMethodRow): Draft {
  return {
    name: m.name,
    description: m.description ?? '',
    fee: String(m.fee),
    isDefault: m.isDefault,
    isActive: m.isActive,
    sortOrder: String(m.sortOrder),
    b2InvoiceType: m.b2InvoiceType ?? '',
  };
}

export function ShippingMethodsClient({ items }: { items: ShippingMethodRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(items.length === 0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);

  async function request(url: string, init: RequestInit): Promise<boolean> {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(j.error?.message ?? `エラーが発生しました (HTTP ${res.status})`);
      return false;
    }
    return true;
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!draft.name.trim()) return setError('配送方法名を入力してください。');
    if (draft.fee === '' || Number(draft.fee) < 0) return setError('送料を 0 以上で入力してください。');
    startTransition(async () => {
      const ok = await request('/api/admin/shipping-methods', {
        method: 'POST',
        body: JSON.stringify(toPayload(draft)),
      });
      if (!ok) return;
      setDraft(emptyDraft);
      setShowForm(false);
      router.refresh();
    });
  }

  function handleSave(id: string) {
    setError(null);
    if (!editDraft.name.trim()) return setError('配送方法名を入力してください。');
    startTransition(async () => {
      const ok = await request(`/api/admin/shipping-methods/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(toPayload(editDraft)),
      });
      if (!ok) return;
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(m: ShippingMethodRow) {
    const msg =
      m.productCount > 0
        ? `「${m.name}」は ${m.productCount} 商品に割り当てられています。削除すると、それらの商品は基本配送に戻ります。削除しますか？`
        : `「${m.name}」を削除しますか？`;
    if (!confirm(msg)) return;
    setError(null);
    startTransition(async () => {
      const ok = await request(`/api/admin/shipping-methods/${m.id}`, { method: 'DELETE' });
      if (!ok) return;
      router.refresh();
    });
  }

  function toggle(m: ShippingMethodRow, field: 'isActive' | 'isDefault') {
    setError(null);
    startTransition(async () => {
      const ok = await request(`/api/admin/shipping-methods/${m.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: !m[field] }),
      });
      if (ok) router.refresh();
    });
  }

  const renderFields = (d: Draft, set: (n: Draft) => void, withPresets: boolean) => (
    <div className="space-y-3">
      {withPresets && (
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => set({ ...d, name: p.name, fee: p.fee, b2InvoiceType: p.b2InvoiceType })}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:border-brand-400 hover:text-brand-700"
            >
              {p.name} ¥{Number(p.fee).toLocaleString('ja-JP')}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="配送方法名"
          value={d.name}
          onChange={(e) => set({ ...d, name: e.target.value })}
          placeholder="例: ネコポス"
          required
        />
        <Input
          label="送料（円・全国一律）"
          type="number"
          min={0}
          value={d.fee}
          onChange={(e) => set({ ...d, fee: e.target.value })}
          placeholder="600"
          required
          hint="0 にすると「送料無料」の配送方法になります"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="説明（任意）"
          value={d.description}
          onChange={(e) => set({ ...d, description: e.target.value })}
          placeholder="例: ポスト投函・追跡あり"
        />
        <Select
          label="ヤマトB2 送り状種類"
          value={d.b2InvoiceType}
          onChange={(e) => set({ ...d, b2InvoiceType: e.target.value })}
        >
          <option value="">未設定（発払い扱い）</option>
          {B2_INVOICE_TYPES.map((t) => (
            <option key={t.code} value={t.code}>
              {t.code}: {t.label}
            </option>
          ))}
        </Select>
        <Input
          label="並び順"
          type="number"
          min={0}
          value={d.sortOrder}
          onChange={(e) => set({ ...d, sortOrder: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={d.isDefault}
            onChange={(e) => set({ ...d, isDefault: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
          />
          基本配送にする
          <span className="text-xs text-slate-500">（配送方法が未設定の商品に自動適用）</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={d.isActive}
            onChange={(e) => set({ ...d, isActive: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
          />
          有効
        </label>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">配送方法一覧（{items.length} 件）</h2>
            {!showForm && (
              <Button size="sm" onClick={() => setShowForm(true)}>
                + 配送方法を追加
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {items.length === 0 && !showForm && (
            <p className="text-sm text-slate-500">配送方法はまだ登録されていません。</p>
          )}

          {items.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {items.map((m) => (
                <li key={m.id} className="px-3 py-3">
                  {editingId === m.id ? (
                    <div className="space-y-3">
                      {renderFields(editDraft, setEditDraft, false)}
                      <div className="flex gap-2">
                        <Button size="sm" loading={pending} onClick={() => handleSave(m.id)}>
                          保存
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => setEditingId(null)}>
                          キャンセル
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-slate-800">{m.name}</span>
                          <span className="text-sm font-semibold text-slate-700">
                            {m.fee === 0 ? '送料無料' : formatJpy(m.fee)}
                          </span>
                          {m.isDefault && <Badge tone="brand">基本配送</Badge>}
                          {!m.isActive && <Badge tone="gray">無効</Badge>}
                          {m.b2InvoiceType && (
                            <Badge tone="info">
                              B2: {B2_INVOICE_TYPES.find((t) => t.code === m.b2InvoiceType)?.label ?? m.b2InvoiceType}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {m.description ?? '―'} ・ {m.productCount} 商品に割当
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1 text-xs">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => toggle(m, 'isDefault')}
                          className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
                        >
                          {m.isDefault ? '基本配送を解除' : '基本配送にする'}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => toggle(m, 'isActive')}
                          className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
                        >
                          {m.isActive ? '無効にする' : '有効にする'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(m.id);
                            setEditDraft(fromRow(m));
                          }}
                          className="rounded px-2 py-1 text-brand-600 hover:bg-brand-50"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(m)}
                          className="rounded px-2 py-1 text-rose-600 hover:bg-rose-50"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {showForm && (
            <form
              onSubmit={handleAdd}
              className="space-y-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4"
            >
              <h3 className="text-sm font-semibold text-slate-700">新しい配送方法</h3>
              {renderFields(draft, setDraft, true)}
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={pending}>
                  追加
                </Button>
                {items.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowForm(false);
                      setDraft(emptyDraft);
                    }}
                  >
                    キャンセル
                  </Button>
                )}
              </div>
            </form>
          )}

          {error && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-1 text-xs text-slate-500">
          <p>※ 配送方法が一つも設定されていない商品には「基本配送」の配送方法が適用されます。</p>
          <p>※ 複数商品をまとめて購入する場合、カート内のすべての商品が対応する配送方法だけが選べます。対応する配送方法が無い組み合わせのときは、いちばん大きい荷物（最低送料が高い商品）側の配送方法に合わせます。</p>
          <p>※ 送料無料条件（スタンダード: ¥8,000 以上 / プレミアム: 常時無料）はプラン特典として全商品に適用されます。</p>
          <p>※ 「ヤマトB2 送り状種類」を設定しておくと、一括発送 CSV に配送方法ごとの送り状種類が出力されます。</p>
        </CardBody>
      </Card>
    </div>
  );
}
