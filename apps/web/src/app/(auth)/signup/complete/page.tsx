import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignupCompleteClient } from './complete-client';

export const metadata: Metadata = { title: '登録完了' };

export default function SignupCompletePage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Suspense fallback={<p className="text-sm text-slate-500">読み込み中…</p>}>
        <SignupCompleteClient />
      </Suspense>
    </div>
  );
}
