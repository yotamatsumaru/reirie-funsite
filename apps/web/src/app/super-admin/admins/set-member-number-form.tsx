'use client';

/**
 * 既存ユーザー (管理者本人など、すでにアカウントを持つ人) の会員番号を
 * メールアドレス指定で直接変更するフォーム。
 *  - 記念会員番号 (RR-000000 等) を運営スタッフ本人に割り当てたい場合に使う。
 *  - 空欄で送信すると会員番号を未設定 (null) に戻す。
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type UpdatedResult = {
  email: string;
  displayName: string | null;
  memberNumber: string | null;
};

export function SetMemberNumberForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [memberNumber, setMemberNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UpdatedResult | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!email.includes('@')) {
      setError('有効なメールアドレスを入力してください。');
      return;
    }
    const trimmed = memberNumber.trim().toUpperCase();
    if (trimmed && !/^RR-\d{6,}$/.test(trimmed)) {
      setError('会員番号は "RR-" + 6桁以上の数字で入力してください (例: RR-000000)。');
      return;
    }
    if (
      !confirm(
        `${email} の会員番号を ${trimmed || '(未設定)'} に変更します。よろしいですか？`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const res = await fetch('/api/super-admin/users/set-member-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, memberNumber: trimmed || null }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as {
        noChange?: boolean;
        user: { email: string; displayName: string | null; memberNumber: string | null };
      };
      setResult(j.user);
      setEmail('');
      setMemberNumber('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            対象ユーザーのメールアドレス <span className="text-rose-500">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            required
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            新しい会員番号（空欄で未設定に戻す）
          </label>
          <input
            type="text"
            value={memberNumber}
            onChange={(e) => setMemberNumber(e.target.value.trim().toUpperCase())}
            placeholder="RR-000001"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
          />
        </div>
      </div>

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        すでにアカウントが存在するユーザー (管理者・スーパー管理者を含む) の会員番号を、
        メールアドレスを指定して直接書き換えます。他のユーザーが使用中の会員番号は指定できません。
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
      >
        {pending ? '変更中...' : '会員番号を変更'}
      </button>

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {result && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-semibold">
            {result.email}
            {result.displayName ? `（${result.displayName}）` : ''} の会員番号を
            {result.memberNumber ? ` ${result.memberNumber}` : '未設定'} に変更しました
          </p>
        </div>
      )}
    </form>
  );
}
