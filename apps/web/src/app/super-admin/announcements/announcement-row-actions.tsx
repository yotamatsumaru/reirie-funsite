'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Status = 'DRAFT' | 'PUBLISHED';

export function AnnouncementRowActions({
  id,
  status,
}: {
  id: string;
  status: Status;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/super-admin/announcements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(j.error?.message ?? `HTTP ${res.status}`);
      return;
    }
    router.refresh();
  }

  async function remove() {
    if (!confirm('このお知らせを削除しますか？この操作は取り消せません。')) return;
    setError(null);
    const res = await fetch(`/api/super-admin/announcements/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(j.error?.message ?? `HTTP ${res.status}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {status === 'DRAFT' ? (
          <button
            type="button"
            onClick={() =>
              startTransition(() => patch({ status: 'PUBLISHED' }))
            }
            disabled={pending}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            公開
          </button>
        ) : (
          <button
            type="button"
            onClick={() => startTransition(() => patch({ status: 'DRAFT' }))}
            disabled={pending}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            下書きに戻す
          </button>
        )}
        <button
          type="button"
          onClick={() => startTransition(() => remove())}
          disabled={pending}
          className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        >
          削除
        </button>
      </div>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
