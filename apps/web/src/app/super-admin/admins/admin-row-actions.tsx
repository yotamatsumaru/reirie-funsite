'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { UserRoleLiteral } from '@idol/shared';

export function AdminRowActions({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: UserRoleLiteral;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function changeRole(role: UserRoleLiteral, confirmMsg: string) {
    if (!confirm(confirmMsg)) return;
    setError(null);
    const res = await fetch(`/api/super-admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(j.error?.message ?? `HTTP ${res.status}`);
      return;
    }
    router.refresh();
  }

  function handleRevoke() {
    startTransition(() =>
      changeRole('USER', `このユーザーから ${currentRole} 権限を剥奪しますか？`),
    );
  }

  function handlePromote() {
    startTransition(() =>
      changeRole('SUPER_ADMIN', '本当にスーパー管理者へ昇格させますか？'),
    );
  }

  function handleDemote() {
    startTransition(() =>
      changeRole('ADMIN', 'スーパー管理者から管理者へ降格させますか？'),
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {currentRole === 'ADMIN' && (
        <button
          type="button"
          onClick={handlePromote}
          disabled={pending}
          className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
        >
          昇格
        </button>
      )}
      {currentRole === 'SUPER_ADMIN' && (
        <button
          type="button"
          onClick={handleDemote}
          disabled={pending}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          降格
        </button>
      )}
      <button
        type="button"
        onClick={handleRevoke}
        disabled={pending}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        権限剥奪
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
