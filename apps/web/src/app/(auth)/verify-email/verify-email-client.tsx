'use client';

/**
 * メール認証ページ。
 * URL のクエリ ?token=... を /api/auth/verify-email に送って認証を完了する。
 * 成功 / 失敗 / トークン無し を分かりやすく表示する。
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';

type Status = 'idle' | 'loading' | 'success' | 'error' | 'no-token';

export function VerifyEmailClient() {
  const params = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!token) {
      setStatus('no-token');
      return;
    }
    setStatus('loading');
    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setStatus('success');
          setMessage(data?.message ?? 'メール認証を完了しました');
        } else {
          setStatus('error');
          setMessage(
            data?.error?.message ??
              'リンクが無効か、有効期限が切れています。お手数ですが再度お試しください。',
          );
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('通信エラーが発生しました。時間をおいて再度お試しください。');
      });
  }, [token]);

  if (status === 'loading' || status === 'idle') {
    return <p className="text-sm text-slate-500">確認しています…</p>;
  }

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

  if (status === 'no-token') {
    return (
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm text-slate-600">
          確認用のトークンが見つかりません。メールに記載のリンクからアクセスしてください。
        </p>
        <Link href="/signin" className="text-sm text-brand-600 hover:underline">
          ログインページへ
        </Link>
      </div>
    );
  }

  // error
  return (
    <div className="space-y-4 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
      <div className="text-4xl">⚠️</div>
      <p className="text-sm font-medium text-rose-700">{message}</p>
      <p className="text-sm text-rose-600">
        ログイン後、マイページから確認メールを再送できます。
      </p>
      <Link href="/signin" className="text-sm text-brand-600 hover:underline">
        ログインページへ
      </Link>
    </div>
  );
}
