/**
 * ユーザー行の操作ボタン群 (Client Component)
 *  - ロール変更
 *  - BAN / 復活
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { UserRoleLiteral } from '@idol/shared';

export function UserRowActions({
  userId,
  currentRole,
  isBanned,
  showRoleSelect = true,
}: {
  userId: string;
  currentRole: UserRoleLiteral;
  isBanned: boolean;
  /** ロール変更セレクトを表示するか。ファンユーザー管理画面では false（昇格は管理者画面に集約）。 */
  showRoleSelect?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function callApi(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/super-admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(j.error?.message ?? `HTTP ${res.status}`);
      return false;
    }
    return true;
  }

  function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const role = e.target.value as UserRoleLiteral;
    if (role === currentRole) return;
    const confirmMsg =
      role === 'SUPER_ADMIN'
        ? '本当に SUPER_ADMIN 権限を付与しますか？(取り消しは別の SUPER_ADMIN のみ可能)'
        : `ロールを ${role} に変更しますか？`;
    if (!confirm(confirmMsg)) {
      e.target.value = currentRole;
      return;
    }
    startTransition(async () => {
      const ok = await callApi({ role });
      if (ok) router.refresh();
    });
  }

  function handleBan() {
    if (!confirm('このユーザーを BAN (退会扱い) しますか？')) return;
    startTransition(async () => {
      const ok = await callApi({ banned: true });
      if (ok) router.refresh();
    });
  }

  function handleRestore() {
    if (!confirm('このユーザーを復活させますか？')) return;
    startTransition(async () => {
      const ok = await callApi({ banned: false });
      if (ok) router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {showRoleSelect && (
        <select
          defaultValue={currentRole}
          onChange={handleRoleChange}
          disabled={pending || isBanned}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
        >
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
          <option value="SUPER_ADMIN">SUPER_ADMIN</option>
        </select>
      )}

      {isBanned ? (
        <button
          type="button"
          onClick={handleRestore}
          disabled={pending}
          className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
        >
          復活
        </button>
      ) : (
        <button
          type="button"
          onClick={handleBan}
          disabled={pending}
          className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
        >
          BAN
        </button>
      )}

      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
