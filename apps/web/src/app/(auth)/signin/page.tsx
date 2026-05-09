import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { SignInForm } from '@/components/auth/SignInForm';

export const metadata: Metadata = { title: 'ログイン' };

export default function SignInPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">ログイン</h1>
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
      <p className="mt-6 text-center text-sm text-slate-600">
        アカウントをお持ちでない方は{' '}
        <Link href="/signup" className="text-brand-600 hover:underline">
          新規登録
        </Link>
      </p>
    </div>
  );
}
