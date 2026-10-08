'use client';

/**
 * 商品詳細ページの「商品オプション（購入時入力項目）」管理。
 *
 * BASE の「商品オプション App」相当。宛名付きチェキの「宛名(ニックネーム)」
 * 「書いてほしい言葉」のように、購入者に文字を入力してもらう項目を定義する。
 *  - 一覧 + インライン編集 (名前 / 文字数 / 追加料金 / 必須 / 案内文)
 *  - 追加 (POST /api/admin/products/[id]/options)
 *  - 削除 (過去の注文には入力値がスナップショットで残るので安全)
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';

export type ProductOptionItem = {
  id: string;
  name: string;
  helpText: string | null;
  maxLength: number;
  price: number;
  isRequired: boolean;
  sortOrder: number;
};

type Draft = {
  name: string;
  helpText: string;
  maxLength: string;
  price: string;
  isRequired: boolean;
};

const emptyDraft: Draft = { name: '', helpText: '', maxLength: '20', price: '0', isRequired: true };

function toPayload(d: Draft) {
  return {
    name: d.name.trim(),
    helpText: d.helpText.trim() || null,
    maxLength: Math.max(1, Number(d.maxLength) || 20),
    price: Math.max(0, Number(d.price) || 0),
    isRequired: d.isRequired,
  };
}

export function OptionManager({
  productId,
  options,
}: {
  productId: string;
  options: ProductOptionItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
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
    if (!draft.name.trim()) {
      setError('オプション名を入力してください。');
      return;
    }
    startTransition(async () => {
      const ok = await request(`/api/admin/products/${productId}/options`, {
        method: 'POST',
        body: JSON.stringify(toPayload(draft)),
      });
      if (!ok) return;
      setDraft(emptyDraft);
      setShowForm(false);
      router.refresh();
    });
  }

  function startEdit(o: ProductOptionItem) {
    setEditingId(o.id);
    setEditDraft({
      name: o.name,
      helpText: o.helpText ?? '',
      maxLength: String(o.maxLength),
      price: String(o.price),
      isRequired: o.isRequired,
    });
  }

  function handleSave(optionId: string) {
    setError(null);
    if (!editDraft.name.trim()) {
      setError('オプション名を入力してください。');
      return;
    }
    startTransition(async () => {
      const ok = await request(`/api/admin/products/${productId}/options/${optionId}`, {
        method: 'PATCH',
        body: JSON.stringify(toPayload(editDraft)),
      });
      if (!ok) return;
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(o: ProductOptionItem) {
    if (!confirm(`オプション「${o.name}」を削除しますか？\n（過去の注文に入力済みの内容は残ります）`)) return;
    setError(null);
    startTransition(async () => {
      const ok = await request(`/api/admin/products/${productId}/options/${o.id}`, {
        method: 'DELETE',
      });
      if (!ok) return;
      router.refresh();
    });
  }

  function move(o: ProductOptionItem, dir: -1 | 1) {
    const idx = options.findIndex((x) => x.id === o.id);
    const swap = options[idx + dir];
    if (!swap) return;
    setError(null);
    startTransition(async () => {
      // sortOrder を入れ替える (同値のときは index で振り直す)
      const a = idx;
      const b = idx + dir;
      const ok1 = await request(`/api/admin/products/${productId}/options/${o.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sortOrder: b }),
      });
      const ok2 = await request(`/api/admin/products/${productId}/options/${swap.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sortOrder: a }),
      });
      if (ok1 && ok2) router.refresh();
    });
  }

  const renderDraftFields = (d: Draft, set: (next: Draft) => void) => (
    <div className="space-y-3">
      <Input
        label="オプション名"
        value={d.name}
        onChange={(e) => set({ ...d, name: e.target.value })}
        placeholder="例: 宛名(ニックネーム)"
        required
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="入力可能文字数"
          type="number"
          min={1}
          max={500}
          value={d.maxLength}
          onChange={(e) => set({ ...d, maxLength: e.target.value })}
        />
        <Input
          label="追加料金（円 / 1点）"
          type="number"
          min={0}
          value={d.price}
          onChange={(e) => set({ ...d, price: e.target.value })}
          hint="0 なら無料"
        />
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={d.isRequired}
            onChange={(e) => set({ ...d, isRequired: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
          />
          入力を必須にする
        </label>
      </div>
      <Textarea
        label="入力ガイドテキスト（任意）"
        rows={2}
        value={d.helpText}
        onChange={(e) => set({ ...d, helpText: e.target.value })}
        placeholder="例: チェキに書いてほしい宛名をご入力ください。無記入を希望の方は「なし」とご入力ください。"
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              商品オプション・購入時入力項目（{options.length} 件）
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              宛名付きチェキの「宛名」など、購入時に購入者へ入力してもらう項目です。
            </p>
          </div>
          {!showForm && (
            <Button size="sm" variant="secondary" onClick={() => setShowForm(true)}>
              + オプションを追加
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {options.length === 0 && !showForm && (
          <p className="text-sm text-slate-500">オプションは設定されていません。</p>
        )}

        {options.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {options.map((o, i) => (
              <li key={o.id} className="px-3 py-3">
                {editingId === o.id ? (
                  <div className="space-y-3">
                    {renderDraftFields(editDraft, setEditDraft)}
                    <div className="flex gap-2">
                      <Button size="sm" loading={pending} onClick={() => handleSave(o.id)}>
                        保存
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => setEditingId(null)}
                      >
                        キャンセル
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-slate-800">{o.name}</span>
                        <Badge tone={o.isRequired ? 'brand' : 'gray'}>
                          {o.isRequired ? '必須' : '任意'}
                        </Badge>
                        <Badge tone="gray">{o.maxLength} 文字まで</Badge>
                        {o.price > 0 && <Badge tone="info">+{formatJpy(o.price)}</Badge>}
                      </div>
                      {o.helpText && (
                        <p className="mt-1 text-xs text-slate-500">{o.helpText}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-xs">
                      <button
                        type="button"
                        disabled={i === 0 || pending}
                        onClick={() => move(o, -1)}
                        className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                        title="上へ"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={i === options.length - 1 || pending}
                        onClick={() => move(o, 1)}
                        className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                        title="下へ"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(o)}
                        className="rounded px-2 py-1 text-brand-600 hover:bg-brand-50"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(o)}
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
            <h3 className="text-sm font-semibold text-slate-700">新しいオプション</h3>
            {renderDraftFields(draft, setDraft)}
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={pending}>
                追加
              </Button>
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
  );
}
