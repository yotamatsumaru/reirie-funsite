'use client';

/**
 * 管理者一覧の行ごとの操作 (ロール変更 / 権限剥奪)。
 *
 * 【以前の問題】
 * 「降格」ボタンはスーパー管理者を **管理者 (ADMIN)** に変えるだけで、
 * スタッフ管理者 (STAFF) にする手段がこの画面に無かった。
 * そのため「スタッフ管理者にしたくて降格したのに、スタッフ欄に出てこない」状態になっていた。
 * また失敗時のエラーが小さな赤文字だけで、成功しても何も表示されなかった。
 *
 * そこで変更先を明示して選べるセレクトにし、結果をトーストで必ず知らせる。
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { USER_ROLE_LABELS, type UserRoleLiteral } from '@idol/shared';
import { toast } from '@/stores/ui-store';

/** この画面で切り替えられる管理系ロール (表示順) */
const ADMIN_ROLES = ['SUPER_ADMIN', 'STAFF', 'ADMIN'] as const satisfies readonly UserRoleLiteral[];
type AdminRole = (typeof ADMIN_ROLES)[number];

/** 変更前に確認ダイアログで見せる説明 (何ができるようになる / できなくなるか) */
const ROLE_CHANGE_NOTES: Record<AdminRole, string> = {
  SUPER_ADMIN: 'KPI 閲覧・ユーザー BAN・返金・ロール変更など、すべての操作ができるようになります。',
  STAFF:
    '運営ダッシュボード (/admin) での登録・編集と、スーパー管理画面の閲覧ができます。\n返金・BAN・ロール変更などはできなくなります。',
  ADMIN: '運営ダッシュボード (/admin) のうち、付与された領域だけを操作できます。\nスーパー管理画面には入れなくなります。',
};

export function AdminRowActions({
  userId,
  currentRole,
  label,
}: {
  userId: string;
  currentRole: UserRoleLiteral;
  /** 確認ダイアログ・トーストに出す名前 (表示名 or メール) */
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const who = label ?? 'このユーザー';

  async function changeRole(role: UserRoleLiteral, confirmMsg: string) {
    if (!confirm(confirmMsg)) return;
    setError(null);
    try {
      const res = await fetch(`/api/super-admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        noChange?: boolean;
      };
      if (!res.ok) {
        const message = j.error?.message ?? `変更に失敗しました (HTTP ${res.status})`;
        setError(message);
        toast.error(message, 'ロールを変更できませんでした');
        return;
      }
      toast.success(
        role === 'USER'
          ? `${who} の管理権限を剥奪しました`
          : `${who} を「${USER_ROLE_LABELS[role]}」に変更しました`,
        'ロールを変更しました',
      );
      router.refresh();
    } catch {
      const message = '通信エラーが発生しました。時間をおいて再度お試しください。';
      setError(message);
      toast.error(message, 'ロールを変更できませんでした');
    }
  }

  function handleRoleSelect(next: AdminRole) {
    if (next === currentRole) return;
    startTransition(() =>
      changeRole(
        next,
        `${who} を「${USER_ROLE_LABELS[currentRole]}」から「${USER_ROLE_LABELS[next]}」に変更しますか？\n\n${ROLE_CHANGE_NOTES[next]}`,
      ),
    );
  }

  function handleRevoke() {
    startTransition(() =>
      changeRole(
        'USER',
        `${who} から「${USER_ROLE_LABELS[currentRole]}」の権限を剥奪し、一般会員に戻しますか？`,
      ),
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-2">
        <label className="sr-only" htmlFor={`role-${userId}`}>
          ロールを変更
        </label>
        <select
          id={`role-${userId}`}
          value={currentRole}
          disabled={pending}
          onChange={(e) => handleRoleSelect(e.target.value as AdminRole)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {ADMIN_ROLES.map((r) => (
            <option key={r} value={r}>
              {r === currentRole ? `${USER_ROLE_LABELS[r]}（現在）` : `${USER_ROLE_LABELS[r]}に変更`}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleRevoke}
          disabled={pending}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          権限剥奪
        </button>
      </div>
      {pending && <span className="text-[11px] text-slate-500">変更中…</span>}
      {error && <span className="max-w-xs text-right text-xs text-rose-600">{error}</span>}
    </div>
  );
}
