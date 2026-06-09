/**
 * Item form (create / edit)
 */
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Card, CardBody } from '@/components/ui/Card';

interface ItemInitial {
  slug: string;
  characterId?: string | null;
  kind: string;
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  priceJpy: number;
  isPremiumOnly: boolean;
  affinityBoost: number;
  maxOwn?: number | null;
  isActive: boolean;
  sortOrder: number;
}

interface CharacterOption {
  id: string;
  name: string;
}

interface Props {
  mode: 'create' | 'edit';
  id?: string;
  initial?: Partial<ItemInitial>;
  characters: CharacterOption[];
}

export function ItemForm({ mode, id, initial, characters }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    slug: initial?.slug ?? '',
    characterId: initial?.characterId ?? '',
    kind: initial?.kind ?? 'GIFT',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    iconUrl: initial?.iconUrl ?? '',
    priceJpy: initial?.priceJpy ?? 100,
    isPremiumOnly: initial?.isPremiumOnly ?? false,
    affinityBoost: initial?.affinityBoost ?? 0,
    maxOwn: initial?.maxOwn ?? '',
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
        slug: form.slug,
        characterId: form.characterId === '' ? null : form.characterId,
        kind: form.kind,
        name: form.name,
        description: form.description || undefined,
        iconUrl: form.iconUrl || undefined,
        priceJpy: Number(form.priceJpy),
        isPremiumOnly: form.isPremiumOnly,
        affinityBoost: Number(form.affinityBoost),
        maxOwn: form.maxOwn === '' ? null : Number(form.maxOwn),
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder),
      };
      const url = mode === 'create' ? '/api/admin/game/items' : `/api/admin/game/items/${id}`;
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
        router.push(`/admin/game/items/${data.item.id}`);
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
    if (!confirm('本当に削除しますか?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/game/items/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('削除に失敗しました');
      router.push('/admin/game/items');
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
            <Select
              label="種別"
              value={form.kind}
              onChange={(e) => onChange('kind', e.target.value)}
            >
              <option value="GIFT">プレゼント (親密度 +)</option>
              <option value="COSMETIC">衣装</option>
              <option value="CG_PACK">CG パック</option>
              <option value="VOICE_PACK">ボイスパック</option>
            </Select>
            <Select
              label="対象キャラ"
              value={form.characterId}
              onChange={(e) => onChange('characterId', e.target.value)}
            >
              <option value="">全キャラ共通</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input
              label="価格 (JPY)"
              type="number"
              value={form.priceJpy}
              onChange={(e) => onChange('priceJpy', e.target.value)}
              inputMode="numeric"
              hint="0 = 配布のみ"
            />
            <Input
              label="親密度ブースト"
              type="number"
              value={form.affinityBoost}
              onChange={(e) => onChange('affinityBoost', e.target.value)}
              inputMode="numeric"
              hint="プレゼント使用時の確定上昇量"
            />
            <Input
              label="所持上限"
              type="number"
              value={form.maxOwn}
              onChange={(e) => onChange('maxOwn', e.target.value)}
              inputMode="numeric"
              hint="空欄=無制限 / 1=一回限り"
            />
            <Input
              label="アイコン URL"
              value={form.iconUrl}
              onChange={(e) => onChange('iconUrl', e.target.value)}
            />
          </div>
          <Textarea
            label="説明"
            rows={3}
            value={form.description}
            onChange={(e) => onChange('description', e.target.value)}
          />
          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => onChange('isActive', e.target.checked)}
                className="h-4 w-4"
              />
              販売中
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isPremiumOnly}
                onChange={(e) => onChange('isPremiumOnly', e.target.checked)}
                className="h-4 w-4"
              />
              PREMIUM 限定
            </label>
            <Input
              label="表示順"
              type="number"
              value={form.sortOrder}
              onChange={(e) => onChange('sortOrder', e.target.value)}
              inputMode="numeric"
              className="w-32"
            />
          </div>

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
