'use client';

/**
 * SNS シェアのテンプレート文 (X / Instagram) 編集フォーム (SUPER_ADMIN)。
 * PATCH /api/super-admin/share-templates で永続化する。
 * URL はシェア時に自動付与されるため、本文に URL を含める必要はない。
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SHARE_TEMPLATE_MAX_LENGTH } from '@idol/shared';
import { Button } from '@/components/ui/Button';

type Templates = { x: string; instagram: string };

const FIELDS: { key: keyof Templates; label: string; help: string }[] = [
  {
    key: 'x',
    label: 'X (旧Twitter) 用のシェア文',
    help: '投稿本文に入る文章です。サイト URL は投稿時に自動で付きます。',
  },
  {
    key: 'instagram',
    label: 'Instagram 用のシェア文',
    help: '共有 / コピーされる文章です。サイト URL は末尾に自動で付きます。',
  },
];

export function ShareTemplateForm({ initial }: { initial: Templates }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<Templates>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  function update(key: keyof Templates, value: string) {
    setTemplates((t) => ({ ...t, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/super-admin/share-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templates),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(j.error?.message ?? `保存に失敗しました (HTTP ${res.status})`);
      setMessage({ tone: 'ok', text: 'シェアテンプレート文を保存しました' });
      router.refresh();
    } catch (e) {
      setMessage({ tone: 'err', text: e instanceof Error ? e.message : 'エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            message.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {message.text}
        </p>
      )}

      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
        シェア時のサイト URL は自動で付与されます。本文に URL を書く必要はありません。
      </p>

      <div className="grid gap-4">
        {FIELDS.map((f) => {
          const value = templates[f.key];
          const over = value.trim().length > SHARE_TEMPLATE_MAX_LENGTH;
          return (
            <div key={f.key} className="rounded-lg border border-slate-200 p-4">
              <label className="block text-sm font-semibold text-slate-800">{f.label}</label>
              <p className="mt-0.5 text-xs text-slate-500">{f.help}</p>
              <textarea
                rows={3}
                value={value}
                onChange={(e) => update(f.key, e.target.value)}
                className="mt-2 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <p
                className={`mt-1 text-right text-xs ${
                  over ? 'text-rose-600' : 'text-slate-400'
                }`}
              >
                {value.trim().length} / {SHARE_TEMPLATE_MAX_LENGTH}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button
          loading={saving}
          onClick={save}
          disabled={
            !templates.x.trim() ||
            !templates.instagram.trim() ||
            templates.x.trim().length > SHARE_TEMPLATE_MAX_LENGTH ||
            templates.instagram.trim().length > SHARE_TEMPLATE_MAX_LENGTH
          }
        >
          保存する
        </Button>
      </div>
    </div>
  );
}
