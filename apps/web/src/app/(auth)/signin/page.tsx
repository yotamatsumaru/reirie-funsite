import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SignInForm } from '@/components/auth/SignInForm';
import { resolveCallbackPath } from '@/lib/callback-path';

export const metadata: Metadata = { title: 'ログイン' };
export const dynamic = 'force-dynamic';

/**
 * すでにログインしている人がログイン画面を開いた (戻るボタン・ブックマーク・古いリンク等) ときは、
 * フォームを出さずに目的のページ (callbackUrl、既定はマイページ) へ移動させる。
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const session = await auth();
  if (session?.user?.id) {
    const { callbackUrl } = await searchParams;
    redirect(resolveCallbackPath(Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl) as never);
  }

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
