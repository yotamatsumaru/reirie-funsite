/**
 * /me/contact/[id] — お問い合わせのやり取り (会員側チャット)
 *
 * 本人のお問い合わせのみ表示 (他人のものは 404)。
 * 開いた時点で運営からのメッセージを既読にする。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Badge } from '@/components/ui/Badge';
import { ContactChat } from '@/components/contact/ContactChat';
import {
  CONTACT_MEMBER_MESSAGE_MAX,
  formatContactTicketNumber,
  type ContactStatusLiteral,
} from '@idol/shared';
import {
  loadMemberThread,
  markThreadReadByMember,
  memberPostDecision,
  toChatMessages,
} from '@/lib/contact-thread';

export const metadata: Metadata = { title: 'お問い合わせ | マイページ' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<ContactStatusLiteral, string> = {
  NEW: '受付済み',
  IN_PROGRESS: '対応中',
  RESOLVED: '回答済み',
  CLOSED: '終了',
};

export default async function MyContactThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/me/contact/${id}`)}`);
  }

  const thread = await loadMemberThread(session.user.id, id);
  if (!thread) notFound();

  const marked = await markThreadReadByMember(session.user.id, id);
  if (marked > 0) {
    const now = new Date();
    for (const r of thread.replies) if (r.sender === 'ADMIN' && !r.readAt) r.readAt = now;
  }

  const canPost = memberPostDecision(thread, session.user.id).ok;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:py-10">
      <header>
        <p className="text-xs text-slate-500">
          <Link href="/me" className="hover:underline">
            マイページ
          </Link>{' '}
          /{' '}
          <Link href="/me/contact" className="hover:underline">
            お問い合わせ
          </Link>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={thread.status === 'CLOSED' ? 'gray' : 'brand'}>{STATUS_LABEL[thread.status]}</Badge>
          <span className="font-mono text-xs text-slate-400">
            受付番号 {formatContactTicketNumber(thread.ticketNumber)}
          </span>
        </div>
        <h1 className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">{thread.subject}</h1>
        <p className="mt-1 text-xs text-slate-500">
          運営から返信が届くと、登録メールアドレスにもお知らせします。
        </p>
      </header>

      <ContactChat
        viewer="MEMBER"
        initialMessages={toChatMessages(thread, 'MEMBER')}
        fetchUrl={`/api/me/contact/${thread.id}`}
        postUrl={`/api/me/contact/${thread.id}/messages`}
        canPost={canPost}
        maxLength={CONTACT_MEMBER_MESSAGE_MAX}
        placeholder="追加のご質問・補足をご入力ください"
        closedNotice="このお問い合わせは終了しています。引き続きご質問がある場合は、新しくお問い合わせください。"
      />
    </div>
  );
}
