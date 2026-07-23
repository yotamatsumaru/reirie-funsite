'use client';

/**
 * ファンユーザーを管理画面から直接登録するフォーム。
 *  - 会員番号 (RR-000000 形式) を明示指定できる (記念番号の割り当てなど)。
 *  - パスワード省略時はサーバーがランダム生成し、その場で一度だけ表示する。
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type CreatedResult = {
  email: string;
  memberNumber: string | null;
  generatedPassword?: string;
};

export function CreateFanUserForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [memberNumber, setMemberNumber] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreatedResult | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!email.includes('@')) {
      setError('有効なメールアドレスを入力してください。');
      return;
    }
    if (memberNumber && !/^RR-\d{6,}$/.test(memberNumber)) {
      setError('会員番号は "RR-" + 6桁以上の数字で入力してください (例: RR-000000)。');
      return;
    }
    if (password && password.length < 8) {
      setError('パスワードは8文字以上で入力してください。');
      return;
    }

    startTransition(async () => {
      const res = await fetch('/api/super-admin/users/create-fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          displayName: displayName || undefined,
          memberNumber: memberNumber || undefined,
          password: password || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as {
        user: { email: string; memberNumber: string | null };
        generatedPassword?: string;
      };
      setResult({
        email: j.user.email,
        memberNumber: j.user.memberNumber,
        generatedPassword: j.generatedPassword,
      });
      setEmail('');
      setDisplayName('');
      setMemberNumber('');
      setPassword('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            メールアドレス <span className="text-rose-500">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="fan@example.com"
            required
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            ニックネーム（任意）
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例: れい"
            maxLength={50}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            会員番号（任意・空欄なら自動採番）
          </label>
          <input
            type="text"
            value={memberNumber}
            onChange={(e) => setMemberNumber(e.target.value.trim().toUpperCase())}
            placeholder="RR-000000"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            パスワード（任意・空欄なら自動生成して表示）
          </label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8文字以上（英大文字・小文字・数字）"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
          />
        </div>
      </div>

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        通常のファン登録（/signup）とは異なり、メール認証をスキップしてすぐにログイン可能な状態で作成します。
        会員番号を空欄にすると通常どおり自動採番されます。
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
      >
        {pending ? '登録中...' : 'ユーザーを登録'}
      </button>

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {result && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-semibold">
            {result.email} を登録しました
            {result.memberNumber ? `（会員番号: ${result.memberNumber}）` : ''}
          </p>
          {result.generatedPassword && (
            <p className="mt-1">
              自動生成パスワード:{' '}
              <code className="rounded bg-white px-2 py-0.5 font-mono text-emerald-900">
                {result.generatedPassword}
              </code>
              <br />
              <span className="text-xs text-emerald-700">
                このパスワードは再表示されません。安全な方法で本人に伝えてください。
              </span>
            </p>
          )}
        </div>
      )}
    </form>
  );
}
