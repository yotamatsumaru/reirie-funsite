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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setLoading(true);
    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    setLoading(false);
    if (!res || res.error) {
      // EMAIL_NOT_VERIFIED: 認証コード未入力のため、専用の案内を表示する。
      if (res?.code === 'EMAIL_NOT_VERIFIED') {
        setNeedsVerification(true);
        setError('メール認証が完了していません。メールに送信した認証コードを入力してください。');
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
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Input
        label="パスワード"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
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
        ログイン
      </Button>
    </form>
  );
}
