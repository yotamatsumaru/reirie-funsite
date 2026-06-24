'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_LABELS,
  type AdminCapabilityLiteral,
} from '@idol/shared';

/**
 * 管理者一覧の各行に表示する「管理権限 ON/OFF」エディタ。
 *  - チェックボックスで CONTENT / MERCH / GAME / CALL を切り替え
 *  - 変更があったときだけ「保存」ボタンが活性化
 *  - PATCH /api/super-admin/admins/[id]/capabilities に送信
 */
export function AdminCapabilityEditor({
  userId,
  initialCapabilities,
}: {
  userId: string;
  initialCapabilities: AdminCapabilityLiteral[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState<AdminCapabilityLiteral[]>(initialCapabilities);

  const dirty =
    selected.length !== initialCapabilities.length ||
    ADMIN_CAPABILITIES.some(
      (c) => selected.includes(c) !== initialCapabilities.includes(c),
    );

  function toggle(cap: AdminCapabilityLiteral) {
    setSaved(false);
    setError(null);
    setSelected((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap],
    );
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await fetch(`/api/super-admin/admins/${userId}/capabilities`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilities: selected }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {ADMIN_CAPABILITIES.map((cap) => {
          const on = selected.includes(cap);
          return (
            <button
              key={cap}
              type="button"
              onClick={() => toggle(cap)}
              disabled={pending}
              className={
                'rounded-full border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ' +
                (on
                  ? 'border-brand-400 bg-brand-50 text-brand-700'
                  : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50')
              }
              aria-pressed={on}
            >
              <span className="mr-1">{on ? '✓' : '＋'}</span>
              {ADMIN_CAPABILITY_LABELS[cap]}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-md border border-brand-500 bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? '保存中…' : '権限を保存'}
        </button>
        {saved && !dirty && <span className="text-xs text-emerald-600">保存しました</span>}
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </div>
  );
}
