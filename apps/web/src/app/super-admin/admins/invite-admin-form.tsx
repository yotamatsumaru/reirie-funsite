'use client';

/**
 * 管理者をメールで招待するフォーム（新規・既存ユーザー両対応）
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  type InvitableRole,
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_LABELS,
  ADMIN_CAPABILITY_DESCRIPTIONS,
  type AdminCapabilityLiteral,
} from '@idol/shared';

export function InviteAdminForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('ADMIN');
  const [capabilities, setCapabilities] = useState<AdminCapabilityLiteral[]>([]);
  const [note, setNote] = useState('');

  function toggleCapability(cap: AdminCapabilityLiteral) {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap],
    );
  }
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

    if (role === 'ADMIN' && capabilities.length === 0) {
      setError('ADMIN を招待する場合は、少なくとも 1 つの管理権限を選択してください。');
      return;
    }

    const msg =
      role === 'SUPER_ADMIN'
        ? `${email} に SUPER_ADMIN 招待を送信しますか？\nすべての操作権限を持つ強力なロールです。`
        : `${email} に ADMIN 招待を送信しますか？`;
    if (!confirm(msg)) return;

    startTransition(async () => {
      const res = await fetch('/api/super-admin/admins/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          role,
          // SUPER_ADMIN は全権限のため capabilities は無視される
          capabilities: role === 'ADMIN' ? capabilities : [],
          note: note || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { isExistingUser?: boolean };
      setSuccess(
        j.isExistingUser
          ? `${email} に招待メールを送信しました（既存ユーザー）。承認後に権限が付与されます。`
          : `${email} に招待メールを送信しました（新規）。アカウント作成後に権限が付与されます。`,
      );
      setEmail('');
      setNote('');
      setCapabilities([]);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            メールアドレス（新規・既存どちらでも可）
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="invitee@example.com"
            required
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">招待するロール</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as InvitableRole)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="ADMIN">ADMIN</option>
            <option value="SUPER_ADMIN">SUPER_ADMIN</option>
          </select>
        </div>
      </div>

      {role === 'ADMIN' ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">
            付与する管理権限（1 つ以上選択）
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ADMIN_CAPABILITIES.map((cap) => {
              const on = capabilities.includes(cap);
              return (
                <label
                  key={cap}
                  className={
                    'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition ' +
                    (on
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50')
                  }
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleCapability(cap)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                  />
                  <span>
                    <span className="font-semibold text-slate-800">
                      {ADMIN_CAPABILITY_LABELS[cap]}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {ADMIN_CAPABILITY_DESCRIPTIONS[cap]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          SUPER_ADMIN はすべての管理権限を自動的に保有します。
        </p>
      )}

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-700">
          メモ（任意・招待メールに記載されます）
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例: 物販オペレーション担当としてお願いします"
          maxLength={500}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
      >
        {pending ? '送信中...' : '招待メールを送信'}
      </button>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {success && <p className="text-xs text-emerald-700">{success}</p>}
    </form>
  );
}
