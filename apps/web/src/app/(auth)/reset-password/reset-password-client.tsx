'use client';

/**
 * パスワード再設定の新しいパスワード入力ページ。
 * ?token=... をURLから受け取り (forgot-password のメールに記載されたリンク経由)、
 * 新しいパスワードを入力して送信する。成功したら /signin へ遷移できるようにする。
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function ResetPasswordClient() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('idle');
    if (newPassword.length < 8) {
      setStatus('error');
      setMessage('パスワードは8文字以上で入力してください');
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus('error');
      setMessage('パスワードが一致しません');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus('success');
        setMessage(data?.message ?? 'パスワードを再設定しました');
      } else {
        setStatus('error');
        setMessage(data?.error?.message ?? 'トークンが無効か、有効期限が切れています');
      }
    } catch {
      setStatus('error');
      setMessage('通信エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="space-y-4 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
        <p className="text-sm text-rose-700">
          リンクが無効です。パスワード再設定用のURLからアクセスしてください。
        </p>
        <Link href="/forgot-password">
          <Button variant="outline" className="w-full" size="lg">
            再設定メールを送信する
          </Button>
        </Link>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="space-y-5 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <div className="text-4xl">✅</div>
        <div>
          <p className="text-base font-semibold text-emerald-800">{message}</p>
          <p className="mt-2 text-sm text-emerald-700">
            新しいパスワードでログインしてください。
          </p>
        </div>
        <Button className="w-full" size="lg" onClick={() => router.push('/signin')}>
          ログインへ進む
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <p className="text-sm text-slate-600">新しいパスワードを入力してください。</p>
      <Input
        label="新しいパスワード"
        type="password"
        name="newPassword"
        autoComplete="new-password"
        required
        minLength={8}
        hint="8文字以上で入力してください"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
      />
      <Input
        label="新しいパスワード (確認)"
        type="password"
        name="confirmPassword"
        autoComplete="new-password"
        required
        minLength={8}
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      {status === 'error' && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{message}</p>
      )}
      <Button type="submit" loading={loading} className="w-full" size="lg">
        パスワードを再設定する
      </Button>
      <Link href="/signin" className="block text-center text-sm text-slate-500 hover:underline">
        ログインページへ戻る
      </Link>
    </form>
  );
}
