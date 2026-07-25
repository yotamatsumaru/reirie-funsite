'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { UserRoleLiteral } from '@idol/shared';

export function GrantAdminForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRoleLiteral>('ADMIN');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.includes('@')) {
      setError('有効なメールアドレスを入力してください。');
      return;
    }

    const msg =
      role === 'SUPER_ADMIN'
        ? `${email} に SUPER_ADMIN 権限を付与しますか？\nすべての操作権限を持つ強力なロールです。`
        : role === 'STAFF'
          ? `${email} に STAFF（スタッフ管理者）権限を付与しますか？\n管理画面を閲覧できますが、返金・BAN などの書き込み操作はできません。`
          : `${email} に ADMIN 権限を付与しますか？`;
    if (!confirm(msg)) return;

    startTransition(async () => {
      const res = await fetch('/api/super-admin/admins/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(`${email} に ${role} 権限を付与しました。`);
      setEmail('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[200px]">
        <label className="mb-1 block text-xs font-semibold text-slate-700">
          メールアドレス (既存ユーザー)
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          required
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-700">付与するロール</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRoleLiteral)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="ADMIN">ADMIN</option>
          <option value="STAFF">STAFF（スタッフ管理者・閲覧のみ）</option>
          <option value="SUPER_ADMIN">SUPER_ADMIN</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
      >
        {pending ? '処理中...' : '権限を付与'}
      </button>

      <div className="w-full">
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {success && <p className="text-xs text-emerald-700">{success}</p>}
      </div>
    </form>
  );
}
