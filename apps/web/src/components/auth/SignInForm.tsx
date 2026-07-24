'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get('callbackUrl') || '/me';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  // TOTP (2段階認証) コード入力ステップ。SUPER_ADMIN が totpEnabled の場合のみ表示される。
  const [needsTotp, setNeedsTotp] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setLoading(true);
    const res = await signIn('credentials', {
      email,
      password,
      // needsTotp になるまでは空文字を送る (未入力扱いにするため)
      totpCode: needsTotp ? totpCode : undefined,
      redirect: false,
      callbackUrl,
    });
    setLoading(false);
    if (!res || res.error) {
      // EMAIL_NOT_VERIFIED: 認証コード未入力のため、専用の案内を表示する。
      if (res?.code === 'EMAIL_NOT_VERIFIED') {
        setNeedsVerification(true);
        setError('メール認証が完了していません。メールに送信した認証コードを入力してください。');
      } else if (res?.code === 'ACCOUNT_LOCKED') {
        // ACCOUNT_LOCKED: ログイン試行回数が多く一時的にロックされている。
        setError(
          'ログイン試行回数が多いため、一時的にアカウントをロックしています。しばらく待ってから再度お試しください。',
        );
      } else if (res?.code === 'TOTP_REQUIRED') {
        // パスワードは検証済み。2段階認証コードの入力欄を表示する。
        setNeedsTotp(true);
        setError(null);
      } else if (res?.code === 'TOTP_INVALID') {
        setNeedsTotp(true);
        setError('2段階認証コードが正しくありません。もう一度入力してください。');
      } else {
        setError('メールアドレスまたはパスワードが正しくありません');
      }
      return;
    }
    toast.success('ログインしました');
    router.push(res.url ?? callbackUrl);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Input
        label="メールアドレス"
        type="email"
        name="email"
        autoComplete="email"
        required
        disabled={needsTotp}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Input
        label="パスワード"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        disabled={needsTotp}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {!needsTotp && (
        <div className="text-right">
          <Link href="/forgot-password" className="text-xs text-brand-600 hover:underline">
            パスワードをお忘れですか？
          </Link>
        </div>
      )}
      {needsTotp && (
        <div className="space-y-1">
          <Input
            label="2段階認証コード"
            hint="認証アプリ (Google Authenticator 等) に表示された6桁のコード、またはバックアップコードを入力してください"
            name="totpCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
          />
        </div>
      )}
      {error && (
        <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          <p>{error}</p>
          {needsVerification && (
            <Link
              href={`/verify-email?email=${encodeURIComponent(email)}`}
              className="mt-1 inline-block font-medium underline"
            >
              認証コードを入力する
            </Link>
          )}
        </div>
      )}
      <Button type="submit" loading={loading} className="w-full" size="lg">
        {needsTotp ? '2段階認証コードを確認してログイン' : 'ログイン'}
      </Button>
      {needsTotp && (
        <button
          type="button"
          className="w-full text-center text-xs text-slate-500 underline"
          onClick={() => {
            setNeedsTotp(false);
            setTotpCode('');
            setError(null);
          }}
        >
          メールアドレス・パスワードを入力し直す
        </button>
      )}
    </form>
  );
}
