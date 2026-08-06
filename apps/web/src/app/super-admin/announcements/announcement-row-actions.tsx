'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SquareArrowOutUpRight } from 'lucide-react';

type Status = 'DRAFT' | 'PUBLISHED';

/**
 * プレビュー URL。
 *
 * 下書きは `?preview=1` を付けたときだけ運営に表示される
 * (判定は sever 側の lib/announcement-visibility.ts)。
 * 他の人がこの URL を開いても 404 になるので共有しても漏れない。
 */
function previewHref(id: string, status: Status): string {
  return status === 'DRAFT' ? `/notices/${id}?preview=1` : `/notices/${id}`;
}

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
        {/*
          公開後と同じ見た目で確認するリンク。
          下書きでも押せるようにして「公開しないと確認できない」を解消する。
          別タブで開くのは、編集中の一覧の状態を失わないため。
        */}
        <a
          href={previewHref(id, status)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
        >
          <SquareArrowOutUpRight className="h-3.5 w-3.5" aria-hidden />
          プレビュー
        </a>
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
