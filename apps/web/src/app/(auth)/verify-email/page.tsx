import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmailClient } from './verify-email-client';

export const metadata: Metadata = { title: 'メールアドレスの確認' };

export default function VerifyEmailPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">メールアドレスの確認</h1>
      <Suspense fallback={<p className="text-sm text-slate-500">読み込み中…</p>}>
        <VerifyEmailClient />
      </Suspense>
    </div>
  );
}
