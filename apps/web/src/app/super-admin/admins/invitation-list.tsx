'use client';

/**
 * 管理者招待の一覧 + 取消 / 再送 操作
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ADMIN_INVITATION_STATUS_LABELS,
  USER_ROLE_LABELS,
  type AdminInvitationStatusLiteral,
  type UserRoleLiteral,
} from '@idol/shared';

export type InvitationItem = {
  id: string;
  email: string;
  role: UserRoleLiteral;
  status: AdminInvitationStatusLiteral;
  note: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  invitedBy: { email: string; displayName: string | null } | null;
  acceptedBy: { email: string; displayName: string | null } | null;
};

const STATUS_TONE: Record<AdminInvitationStatusLiteral, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  ACCEPTED: 'bg-emerald-100 text-emerald-800',
  REVOKED: 'bg-slate-200 text-slate-600',
  EXPIRED: 'bg-slate-200 text-slate-500',
};

export function InvitationList({ invitations }: { invitations: InvitationItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function revoke(id: string, email: string) {
    if (!confirm(`${email} への招待を取消しますか？`)) return;
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fetch(`/api/super-admin/admins/invitations/${id}`, { method: 'DELETE' });
      setBusyId(null);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    });
  }

  function resend(id: string, email: string) {
    if (!confirm(`${email} に招待メールを再送しますか？（有効期限が延長されます）`)) return;
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fetch(`/api/super-admin/admins/invitations/${id}`, { method: 'POST' });
      setBusyId(null);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    });
  }

  if (invitations.length === 0) {
    return (
      <p className="px-5 py-6 text-center text-sm text-slate-500">招待履歴はまだありません。</p>
    );
  }

  return (
    <div>
      {error && <p className="px-4 pt-3 text-xs text-rose-600">{error}</p>}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">招待先</th>
              <th className="px-4 py-3">ロール</th>
              <th className="px-4 py-3">状態</th>
              <th className="px-4 py-3">有効期限</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invitations.map((inv) => {
              const isPending = inv.status === 'PENDING';
              const canResend = inv.status === 'PENDING' || inv.status === 'EXPIRED';
              const busy = pending && busyId === inv.id;
              return (
                <tr key={inv.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{inv.email}</p>
                    {inv.note && <p className="text-xs text-slate-400">{inv.note}</p>}
                    {inv.invitedBy && (
                      <p className="text-xs text-slate-400">
                        招待者: {inv.invitedBy.displayName ?? inv.invitedBy.email}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {USER_ROLE_LABELS[inv.role]}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[inv.status]}`}
                    >
                      {ADMIN_INVITATION_STATUS_LABELS[inv.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {new Date(inv.expiresAt).toLocaleString('ja-JP', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {canResend && (
                        <button
                          type="button"
                          onClick={() => resend(inv.id, inv.email)}
                          disabled={busy}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          再送
                        </button>
                      )}
                      {isPending && (
                        <button
                          type="button"
                          onClick={() => revoke(inv.id, inv.email)}
                          disabled={busy}
                          className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                        >
                          取消
                        </button>
                      )}
                      {!canResend && !isPending && (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
