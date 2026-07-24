import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordClient } from './reset-password-client';

export const metadata: Metadata = { title: 'パスワードの再設定' };

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">パスワードの再設定</h1>
      <Suspense fallback={<p className="text-sm text-slate-500">読み込み中…</p>}>
        <ResetPasswordClient />
      </Suspense>
    </div>
  );
}
