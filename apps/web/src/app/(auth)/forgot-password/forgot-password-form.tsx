'use client';

/**
 * パスワード再設定メールの送信フォーム。
 * メールアドレスを入力して送信すると、有効なアカウントであれば
 * パスワード再設定用のURLがメールで送られる (存在しないメールでも同じ成功表示にする)。
 */
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus('success');
        setMessage(data?.message ?? '入力されたメールアドレスにパスワード再設定の案内を送信しました');
      } else {
        setStatus('error');
        setMessage(data?.error?.message ?? '送信に失敗しました。時間をおいて再度お試しください。');
      }
    } catch {
      setStatus('error');
      setMessage('通信エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  if (status === 'success') {
    return (
      <div className="space-y-5 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <div className="text-4xl">📩</div>
        <div>
          <p className="text-base font-semibold text-emerald-800">送信しました</p>
          <p className="mt-2 text-sm text-emerald-700">{message}</p>
          <p className="mt-2 text-xs text-emerald-700">
            メールが届かない場合は、迷惑メールフォルダもご確認ください。
          </p>
        </div>
        <Link href="/signin">
          <Button variant="outline" className="w-full" size="lg">
            ログインページへ戻る
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <p className="text-sm text-slate-600">
        ご登録のメールアドレスを入力してください。パスワード再設定用のURLをお送りします。
      </p>
      <Input
        label="メールアドレス"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {status === 'error' && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{message}</p>
      )}
      <Button type="submit" loading={loading} className="w-full" size="lg">
        再設定メールを送信する
      </Button>
      <Link href="/signin" className="block text-center text-sm text-slate-500 hover:underline">
        ログインページへ戻る
      </Link>
    </form>
  );
}
