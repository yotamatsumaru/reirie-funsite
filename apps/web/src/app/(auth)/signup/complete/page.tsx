import { redirect } from 'next/navigation';

export const metadata = { title: '登録完了' };

/**
 * 旧フロー (リンク認証方式) の登録完了ページ。
 * 認証コード方式への変更により、このページへの遷移は発生しなくなったが、
 * 古いブックマーク/メールリンクからのアクセスに備えて
 * 新しい認証コード入力ページ (/verify-email) へ誘導する。
 */
export default async function SignupCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const qs = email ? `?email=${encodeURIComponent(email)}` : '';
  redirect(`/verify-email${qs}`);
}
