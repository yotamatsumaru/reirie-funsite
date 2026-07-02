/**
 * 景品カタログ フォーム (作成 / 編集)
 */
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Card, CardBody } from '@/components/ui/Card';

interface CatalogInitial {
  slug: string;
  kind: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  pointCost: number;
  stock?: number | null;
  status: string;
  sortOrder: number;
}

interface Props {
  mode: 'create' | 'edit';
  id?: string;
  initial?: Partial<CatalogInitial>;
}

export function CatalogForm({ mode, id, initial }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    slug: initial?.slug ?? '',
    kind: initial?.kind ?? 'GOODS',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    imageUrl: initial?.imageUrl ?? '',
    pointCost: initial?.pointCost ?? 1000,
    stock: initial?.stock ?? '',
    status: initial?.status ?? 'DRAFT',
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
        slug: form.slug,
        kind: form.kind,
        name: form.name,
        description: form.description || undefined,
        imageUrl: form.imageUrl || undefined,
        pointCost: Number(form.pointCost),
        stock: form.stock === '' ? null : Number(form.stock),
        status: form.status,
        sortOrder: Number(form.sortOrder),
      };
      const url = mode === 'create' ? '/api/admin/reward-catalog' : `/api/admin/reward-catalog/${id}`;
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
        router.push(`/admin/rewards/catalog/${data.item.id}`);
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
    if (!confirm('本当に削除しますか? (交換履歴がある場合はアーカイブ扱いになります)')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/reward-catalog/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('削除に失敗しました');
      router.push('/admin/rewards/catalog');
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
              label="slug (英数+ハイフン)"
              value={form.slug}
              onChange={(e) => onChange('slug', e.target.value)}
              autoComplete="off"
              required
            />
            <Input
              label="名前"
              value={form.name}
              onChange={(e) => onChange('name', e.target.value)}
              required
            />
            <Select label="種別" value={form.kind} onChange={(e) => onChange('kind', e.target.value)}>
              <option value="GOODS">グッズ (発送)</option>
              <option value="CALL_PRIORITY">特典会優先枠</option>
              <option value="DIGITAL">デジタル特典</option>
            </Select>
            <Select
              label="公開状態"
              value={form.status}
              onChange={(e) => onChange('status', e.target.value)}
            >
              <option value="DRAFT">下書き</option>
              <option value="PUBLISHED">公開中</option>
              <option value="ARCHIVED">アーカイブ</option>
            </Select>
            <Input
              label="必要特典ポイント"
              type="number"
              value={form.pointCost}
              onChange={(e) => onChange('pointCost', e.target.value)}
              inputMode="numeric"
              required
            />
            <Input
              label="在庫数"
              type="number"
              value={form.stock}
              onChange={(e) => onChange('stock', e.target.value)}
              inputMode="numeric"
              hint="空欄=無制限"
            />
            <Input
              label="画像 URL"
              value={form.imageUrl}
              onChange={(e) => onChange('imageUrl', e.target.value)}
            />
            <Input
              label="表示順"
              type="number"
              value={form.sortOrder}
              onChange={(e) => onChange('sortOrder', e.target.value)}
              inputMode="numeric"
            />
          </div>
          <Textarea
            label="説明"
            rows={3}
            value={form.description}
            onChange={(e) => onChange('description', e.target.value)}
          />

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
