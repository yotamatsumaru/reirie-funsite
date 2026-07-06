/**
 * 特典ポイントパック フォーム (作成 / 編集)
 */
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardBody } from '@/components/ui/Card';

interface PackInitial {
  name: string;
  points: number;
  priceJpy: number;
  isActive: boolean;
  sortOrder: number;
}

interface Props {
  mode: 'create' | 'edit';
  id?: string;
  initial?: Partial<PackInitial>;
}

export function PackForm({ mode, id, initial }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    points: initial?.points ?? 500,
    priceJpy: initial?.priceJpy ?? 500,
    isActive: initial?.isActive ?? true,
    sortOrder: initial?.sortOrder ?? 0,
  });

  const onChange = (k: keyof typeof form, v: unknown) =>
    setForm((s) => ({ ...s, [k]: v as never }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        points: Number(form.points),
        priceJpy: Number(form.priceJpy),
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder),
      };
      const url =
        mode === 'create'
          ? '/api/super-admin/reward-point-packs'
          : `/api/super-admin/reward-point-packs/${id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '保存に失敗しました');
      }
      const data = await res.json();
      if (mode === 'create') {
        router.push(`/super-admin/rewards/packs/${data.pack.id}`);
      } else {
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!confirm('本当に削除しますか? (購入履歴がある場合は非活性化されます)')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/super-admin/reward-point-packs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('削除に失敗しました');
      router.push('/super-admin/rewards/packs');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label="表示名"
              value={form.name}
              onChange={(e) => onChange('name', e.target.value)}
              required
            />
            <Input
              label="付与ポイント数"
              type="number"
              value={form.points}
              onChange={(e) => onChange('points', e.target.value)}
              inputMode="numeric"
              required
            />
            <Input
              label="販売価格 (JPY・税込)"
              type="number"
              value={form.priceJpy}
              onChange={(e) => onChange('priceJpy', e.target.value)}
              inputMode="numeric"
              required
            />
            <Input
              label="表示順"
              type="number"
              value={form.sortOrder}
              onChange={(e) => onChange('sortOrder', e.target.value)}
              inputMode="numeric"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => onChange('isActive', e.target.checked)}
              className="h-4 w-4"
            />
            販売中
          </label>

          {error && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={busy}>
              {mode === 'create' ? '作成する' : '保存する'}
            </Button>
            {mode === 'edit' && (
              <Button type="button" variant="danger" onClick={handleDelete} disabled={busy}>
                削除
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
