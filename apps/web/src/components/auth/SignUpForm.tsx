'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';

export function SignUpForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, displayName: displayName || undefined }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? '登録に失敗しました');
      }
      const signInRes = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl: '/me',
      });
      if (!signInRes || signInRes.error) {
        toast.success('登録完了。ログイン画面でログインしてください');
        router.push('/signin');
        return;
      }
      toast.success('登録が完了しました');
      router.push('/me');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Input
        label="表示名 (任意)"
        type="text"
        name="displayName"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={50}
      />
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
        autoComplete="new-password"
        required
        minLength={8}
        hint="8文字以上"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <Button type="submit" loading={loading} className="w-full" size="lg">
        登録する
      </Button>
      <p className="text-xs text-slate-500">
        登録することで <a href="/terms" className="underline">利用規約</a> および{' '}
        <a href="/privacy" className="underline">プライバシーポリシー</a> に同意したものとみなされます。
      </p>
    </form>
  );
}
