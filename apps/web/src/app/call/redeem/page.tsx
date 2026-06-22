/**
 * /call/redeem
 *
 * CD 封入シリアルコードを入力して特典会チケットを発行するページ。
 *
 * 認可:
 *   - 未ログイン -> /signin にリダイレクト
 *   - FREE プラン -> /plans へ案内 (ファンクラブ会員のみ参加可)
 *
 * フォーム送信は client component で fetch (/api/call/redeem) を叩く。
 * 引換成功時は /call/events/[eventId]/waiting に遷移する。
 */
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { canAccess } from '@idol/shared';
import { RedeemForm } from './RedeemForm';

export const runtime = 'nodejs';

export default async function CallRedeemPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/call/redeem');
  }
  const isMember = canAccess(session.user.plan, 'MEMBERS');

  if (!isMember) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-bold text-slate-900">特典会チケット引換</h1>
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm text-amber-900">
            1on1 特典会へのご参加には <strong>ファンクラブ会員 (スタンダード以上)</strong> へのご加入が必要です。
          </p>
          <Link
            href="/plans"
            className="mt-4 inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            プランを見る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold text-slate-900">特典会チケット引換</h1>
      <p className="mt-2 text-sm text-slate-600">
        CD に封入されているシリアルコードを入力してください。引換完了後、待機室にご案内します。
      </p>
      <div className="mt-6">
        <RedeemForm />
      </div>
      <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
        <p className="font-medium text-slate-700">注意事項</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>シリアルコードは 1 回のみご利用いただけます。</li>
          <li>同じイベントに対し 1 ユーザーにつき 1 チケットまでです。</li>
          <li>引換後のキャンセル・払い戻しはできません。</li>
        </ul>
      </div>
    </div>
  );
}
