/**
 * /me/contact — 自分のお問い合わせ一覧 (チャット形式のやり取りの入口)
 *
 * 最近やり取りがあった順に並べ、運営からの未読メッセージがあるものに件数を出す。
 * 各行から /me/contact/[id] のチャット画面へ進む。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { auth } from '@/auth';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  CONTACT_STATUS_LABELS,
  formatContactTicketNumber,
  formatJstDateTime,
  type ContactStatusLiteral,
} from '@idol/shared';
import { listMemberThreads } from '@/lib/contact-thread';

export const metadata: Metadata = { title: 'お問い合わせ | マイページ' };
export const dynamic = 'force-dynamic';

/** 会員向けの対応状況の表示 (運営内部の「新規」は「受付済み」と見せる) */
const MEMBER_STATUS_LABEL: Record<ContactStatusLiteral, string> = {
  NEW: '受付済み',
  IN_PROGRESS: CONTACT_STATUS_LABELS.IN_PROGRESS,
  RESOLVED: '回答済み',
  CLOSED: '終了',
};
const STATUS_TONE: Record<ContactStatusLiteral, 'info' | 'warning' | 'success' | 'gray'> = {
  NEW: 'info',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  CLOSED: 'gray',
};

export default async function MyContactListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/contact');

  const threads = await listMemberThreads(session.user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">
            <Link href="/me" className="hover:underline">
              マイページ
            </Link>{' '}
            / お問い合わせ
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">お問い合わせ</h1>
          <p className="mt-1 text-sm text-slate-500">
            運営とのやり取りをチャット形式で確認・続けて質問できます。
          </p>
        </div>
        <Link
          href="/contact"
          className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          新しくお問い合わせ
        </Link>
      </header>

      {threads.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-8 text-center text-sm text-slate-500">
              まだお問い合わせはありません。
              <br />
              ログインした状態でお問い合わせフォームから送ると、ここでやり取りできます。
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-3">
          {threads.map((t) => (
            <li key={t.id}>
              <Link
                href={`/me/contact/${t.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-200 hover:shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[t.status]}>{MEMBER_STATUS_LABEL[t.status]}</Badge>
                  {t.unreadCount > 0 && <Badge tone="brand">新着 {t.unreadCount}</Badge>}
                  <span className="font-mono text-xs text-slate-400">
                    {formatContactTicketNumber(t.ticketNumber)}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    {formatJstDateTime(t.lastMessageAt)}
                  </span>
                </div>
                <p className="mt-2 font-semibold text-slate-800">{t.subject}</p>
                <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-slate-500">
                  <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="shrink-0 text-xs font-semibold">
                    {t.lastSender === 'ADMIN' ? '運営' : 'あなた'}:
                  </span>
                  <span className="truncate">{t.lastPreview}</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
