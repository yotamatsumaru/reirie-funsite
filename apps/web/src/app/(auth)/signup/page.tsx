import type { Metadata } from 'next';
import Link from 'next/link';
import { SignUpForm } from '@/components/auth/SignUpForm';

export const metadata: Metadata = { title: '新規会員登録' };

export default function SignUpPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">新規会員登録</h1>
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-slate-600">
        すでにアカウントをお持ちの方は{' '}
        <Link href="/signin" className="text-brand-600 hover:underline">
          ログイン
        </Link>
      </p>
    </div>
  );
}
