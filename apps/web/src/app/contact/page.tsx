/**
 * /contact — お問い合わせフォーム (公開ページ)
 *
 * - ゲスト / ログインユーザーのどちらからも送信できる。
 * - ログイン中はお名前・メールを初期値としてプリフィルする。
 * - 送信内容は管理画面 (/super-admin/contact) で確認する。
 */
import type { Metadata } from 'next';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { ContactForm } from './contact-form';

export const metadata: Metadata = {
  title: 'お問い合わせ',
  description: 'ReiRieRoom へのお問い合わせはこちらのフォームからお送りください。',
};
export const dynamic = 'force-dynamic';

export default async function ContactPage() {
  const session = await auth();

  let defaultName = '';
  let defaultEmail = '';
  if (session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { fullName: true, displayName: true, email: true },
    });
    defaultName = user?.fullName?.trim() || user?.displayName?.trim() || '';
    defaultEmail = user?.email ?? '';
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-slate-800 sm:text-3xl">お問い合わせ</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        ReiRieRoom に関するご質問・ご要望は、以下のフォームよりお送りください。
        <br />
        内容を確認のうえ、ご入力いただいたメールアドレス宛にご返信いたします。
      </p>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <ContactForm defaultName={defaultName} defaultEmail={defaultEmail} />
      </div>

      <p className="mt-6 text-xs leading-relaxed text-slate-400">
        ※ お問い合わせ内容の確認・ご返信までにお時間をいただく場合があります。
        <br />
        ※ 内容によってはご返信いたしかねる場合がございます。あらかじめご了承ください。
      </p>
    </div>
  );
}
