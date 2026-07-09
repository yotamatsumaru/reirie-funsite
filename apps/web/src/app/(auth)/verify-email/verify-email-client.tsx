'use client';

/**
 * メール認証コード入力ページ。
 * ?email=... をURLから受け取り、メールで送られた6桁コードを入力してもらう。
 * 成功したら /signin に遷移する。コード再送も可能。
 */
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function VerifyEmailClient() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus('success');
        setMessage(data?.message ?? 'メール認証を完了しました');
      } else {
        setStatus('error');
        setMessage(data?.error?.message ?? '認証コードが正しくないか、有効期限が切れています');
      }
    } catch {
      setStatus('error');
      setMessage('通信エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!email) return;
    setResending(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/auth/resend-verification-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      setStatus(res.ok ? 'idle' : 'error');
      setMessage(data?.message ?? (res.ok ? '認証コードを再送しました' : '再送に失敗しました'));
    } catch {
      setStatus('error');
      setMessage('通信エラーが発生しました。時間をおいて再度お試しください。');
    } finally {
      setResending(false);
    }
  };

  if (status === 'success') {
    return (
      <div className="space-y-5 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <div className="text-4xl">✅</div>
        <div>
          <p className="text-base font-semibold text-emerald-800">{message}</p>
          <p className="mt-2 text-sm text-emerald-700">
            ご登録ありがとうございます。ログインしてご利用を開始できます。
          </p>
        </div>
        <Link href="/signin">
          <Button className="w-full" size="lg">
            ログインへ進む
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <p className="text-sm text-slate-600">
        ご登録いただいたメールアドレスに送信された6桁の認証コードを入力してください。
      </p>
      <Input
        label="メールアドレス"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Input
        label="認証コード (6桁)"
        type="text"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        required
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
      />
      {status === 'error' && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{message}</p>
      )}
      <Button type="submit" loading={loading} className="w-full" size="lg">
        認証する
      </Button>
      <button
        type="button"
        onClick={resend}
        disabled={resending || !email}
        className="w-full text-sm text-brand-600 hover:underline disabled:opacity-50"
      >
        {resending ? '再送中…' : 'コードを再送する'}
      </button>
      <Link href="/signin" className="block text-center text-sm text-slate-500 hover:underline">
        ログインページへ
      </Link>
    </form>
  );
}
