'use client';

/**
 * 管理者招待の受諾フォーム
 *  - 新規ユーザー: ニックネーム + パスワードでアカウント作成 → 受諾 → 自動ログイン
 *  - 既存ユーザー(未ログイン): パスワードでログイン → 受諾
 *  - 既存ユーザー(ログイン済み): 承認ボタンのみ
 */
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';

export function AcceptInviteForm({
  token,
  email,
  isExistingUser,
  loggedInAsInvitee,
}: {
  token: string;
  email: string;
  isExistingUser: boolean;
  loggedInAsInvitee: boolean;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 新規アカウント作成が必要か
  const needsNewAccount = !isExistingUser;
  // 既存ユーザーだが未ログイン → ログインしてから承認
  const needsLogin = isExistingUser && !loggedInAsInvitee;

  async function acceptInvitation(extra?: { displayName?: string; password?: string }) {
    const res = await fetch(`/api/admin-invite/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(extra ?? {}),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      mode?: string;
      requiresLogin?: boolean;
      error?: { message?: string };
    };
    return { res, json };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // --- 既存ユーザー・未ログイン: まずログイン ---
      if (needsLogin) {
        const signInRes = await signIn('credentials', {
          email,
          password,
          redirect: false,
        });
        if (!signInRes || signInRes.error) {
          setError('パスワードが正しくありません');
          setLoading(false);
          return;
        }
      }

      // --- 受諾 ---
      const { res, json } = needsNewAccount
        ? await acceptInvitation({ displayName, password })
        : await acceptInvitation();

      if (!res.ok || !json.ok) {
        if (json.requiresLogin) {
          setError('このメールアドレスでログインしてから承認してください。');
        } else {
          setError(json.error?.message ?? `エラーが発生しました (HTTP ${res.status})`);
        }
        setLoading(false);
        return;
      }

      // --- 新規アカウント: 作成後に自動ログイン ---
      if (json.mode === 'new') {
        await signIn('credentials', { email, password, redirect: false });
      }

      toast.success('管理者権限を承認しました');
      router.push('/super-admin');
      router.refresh();
    } catch {
      setError('予期しないエラーが発生しました');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {needsNewAccount && (
        <>
          <p className="rounded-md bg-twilight-amethyst/10 px-3 py-2 text-xs text-twilight-amethyst">
            このメールアドレスのアカウントはまだ存在しません。
            ニックネームとパスワードを設定してアカウントを作成し、招待を承認します。
          </p>
          <Input
            label="ニックネーム"
            name="displayName"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Input
            label="パスワード (8文字以上)"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </>
      )}

      {needsLogin && (
        <>
          <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
            既存のアカウント（{email}）が見つかりました。
            パスワードを入力してログインのうえ、招待を承認してください。
          </p>
          <Input
            label="パスワード"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </>
      )}

      {!needsNewAccount && !needsLogin && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {email} としてログイン中です。下のボタンで招待を承認してください。
        </p>
      )}

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <Button type="submit" loading={loading} className="w-full" size="lg">
        {needsNewAccount ? 'アカウントを作成して承認' : '招待を承認する'}
      </Button>
    </form>
  );
}
