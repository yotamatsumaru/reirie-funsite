/**
 * Character form (create / edit) — client component
 */
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Card, CardBody } from '@/components/ui/Card';

interface CharacterInitial {
  slug: string;
  name: string;
  furigana?: string | null;
  catchcopy?: string | null;
  description?: string | null;
  age?: number | null;
  birthday?: string | null;
  bloodType?: string | null;
  height?: number | null;
  portraitUrl?: string | null;
  spriteUrl?: string | null;
  themeColor?: string | null;
  status: string;
  sortOrder: number;
  isPremiumOnly: boolean;
  affinityMax: number;
}

interface Props {
  mode: 'create' | 'edit';
  id?: string;
  initial?: Partial<CharacterInitial>;
}

export function CharacterForm({ mode, id, initial }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    slug: initial?.slug ?? '',
    name: initial?.name ?? '',
    furigana: initial?.furigana ?? '',
    catchcopy: initial?.catchcopy ?? '',
    description: initial?.description ?? '',
    age: initial?.age ?? '',
    birthday: initial?.birthday ?? '',
    bloodType: initial?.bloodType ?? '',
    height: initial?.height ?? '',
    portraitUrl: initial?.portraitUrl ?? '',
    spriteUrl: initial?.spriteUrl ?? '',
    themeColor: initial?.themeColor ?? '#ed1c75',
    status: initial?.status ?? 'DRAFT',
    sortOrder: initial?.sortOrder ?? 0,
    isPremiumOnly: initial?.isPremiumOnly ?? false,
    affinityMax: initial?.affinityMax ?? 100,
  });

  const onChange = (k: keyof typeof form, v: unknown) =>
    setForm((s) => ({ ...s, [k]: v as never }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...form,
        age: form.age === '' ? undefined : Number(form.age),
        height: form.height === '' ? undefined : Number(form.height),
        sortOrder: Number(form.sortOrder),
        affinityMax: Number(form.affinityMax),
        furigana: form.furigana || undefined,
        catchcopy: form.catchcopy || undefined,
        description: form.description || undefined,
        birthday: form.birthday || undefined,
        bloodType: form.bloodType || undefined,
        portraitUrl: form.portraitUrl || undefined,
        spriteUrl: form.spriteUrl || undefined,
        themeColor: form.themeColor || undefined,
      };
      const url = mode === 'create' ? '/api/admin/game/characters' : `/api/admin/game/characters/${id}`;
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
        router.push(`/admin/game/characters/${data.character.id}`);
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
    if (!confirm('本当に削除しますか? (進捗があるキャラはアーカイブされます)')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/game/characters/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('削除に失敗しました');
      router.push('/admin/game/characters');
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
              required
              autoComplete="off"
            />
            <Input
              label="名前"
              value={form.name}
              onChange={(e) => onChange('name', e.target.value)}
              required
            />
            <Input
              label="ふりがな"
              value={form.furigana}
              onChange={(e) => onChange('furigana', e.target.value)}
            />
            <Input
              label="キャッチコピー"
              value={form.catchcopy}
              onChange={(e) => onChange('catchcopy', e.target.value)}
            />
            <Input
              label="年齢"
              type="number"
              value={form.age}
              onChange={(e) => onChange('age', e.target.value)}
              inputMode="numeric"
            />
            <Input
              label="誕生日 (MM-DD)"
              value={form.birthday}
              onChange={(e) => onChange('birthday', e.target.value)}
              placeholder="04-15"
            />
            <Select
              label="血液型"
              value={form.bloodType}
              onChange={(e) => onChange('bloodType', e.target.value)}
            >
              <option value="">未設定</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="O">O</option>
              <option value="AB">AB</option>
            </Select>
            <Input
              label="身長 (cm)"
              type="number"
              value={form.height}
              onChange={(e) => onChange('height', e.target.value)}
              inputMode="numeric"
            />
          </div>

          <Textarea
            label="紹介文"
            rows={4}
            value={form.description}
            onChange={(e) => onChange('description', e.target.value)}
          />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label="ポートレイト画像 URL"
              value={form.portraitUrl}
              onChange={(e) => onChange('portraitUrl', e.target.value)}
              placeholder="https://..."
            />
            <Input
              label="立ち絵 URL (デフォルト)"
              value={form.spriteUrl}
              onChange={(e) => onChange('spriteUrl', e.target.value)}
              placeholder="https://..."
            />
            <Input
              label="テーマカラー (#RRGGBB)"
              value={form.themeColor}
              onChange={(e) => onChange('themeColor', e.target.value)}
              placeholder="#ed1c75"
            />
            <Input
              label="表示順"
              type="number"
              value={form.sortOrder}
              onChange={(e) => onChange('sortOrder', e.target.value)}
              inputMode="numeric"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Select
              label="状態"
              value={form.status}
              onChange={(e) => onChange('status', e.target.value)}
            >
              <option value="DRAFT">DRAFT (下書き)</option>
              <option value="PUBLISHED">PUBLISHED (公開)</option>
              <option value="ARCHIVED">ARCHIVED (アーカイブ)</option>
            </Select>
            <Input
              label="親密度上限"
              type="number"
              value={form.affinityMax}
              onChange={(e) => onChange('affinityMax', e.target.value)}
              inputMode="numeric"
            />
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isPremiumOnly}
                onChange={(e) => onChange('isPremiumOnly', e.target.checked)}
                className="h-4 w-4"
              />
              PREMIUM 会員限定
            </label>
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
              <Button
                type="button"
                variant="danger"
                onClick={handleDelete}
                disabled={busy}
              >
                削除 / アーカイブ
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
