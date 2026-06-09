'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Audience = 'ALL' | 'MEMBERS' | 'PREMIUM';
type Status = 'DRAFT' | 'PUBLISHED';

export function AnnouncementForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('ALL');
  const [status, setStatus] = useState<Status>('DRAFT');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!title.trim() || !body.trim()) {
      setError('タイトルと本文は必須です');
      return;
    }

    startTransition(async () => {
      const res = await fetch('/api/super-admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          audience,
          status,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      setTitle('');
      setBody('');
      setAudience('ALL');
      setStatus('DRAFT');
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-slate-700">
          タイトル <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          maxLength={200}
          placeholder="例: 【重要】サービス障害のお知らせ"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700">
          本文 <span className="text-rose-500">*</span>
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={pending}
          rows={6}
          maxLength={4000}
          placeholder="改行可。Markdown は使えません。"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
        />
        <p className="mt-1 text-right text-[10px] text-slate-400">
          {body.length} / 4000
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700">
            配信対象
          </label>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as Audience)}
            disabled={pending}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
          >
            <option value="ALL">全ユーザー</option>
            <option value="MEMBERS">会員のみ</option>
            <option value="PREMIUM">PREMIUM 会員のみ</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            ステータス
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            disabled={pending}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
          >
            <option value="DRAFT">下書きとして保存</option>
            <option value="PUBLISHED">すぐに公開</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          ✓ お知らせを作成しました
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {pending
            ? '作成中…'
            : status === 'PUBLISHED'
              ? '公開する'
              : '下書き保存'}
        </button>
      </div>
    </form>
  );
}
