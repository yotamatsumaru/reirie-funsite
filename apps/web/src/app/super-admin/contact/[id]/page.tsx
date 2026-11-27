/**
 * /super-admin/contact/[id] — お問い合わせのやり取り (運営側チャット)
 *
 * SUPER_ADMIN と STAFF が返信・対応状況の変更・管理メモの編集をできる。
 * 開いた時点で会員からの追加メッセージを「運営が既読」にする。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { requireSuperAdminView } from '@/auth';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ContactChat } from '@/components/contact/ContactChat';
import {
  CONTACT_CATEGORY_LABELS,
  CONTACT_REPLY_MAX,
  CONTACT_STATUS_LABELS,
  formatContactTicketNumber,
  type ContactCategoryLiteral,
  type ContactStatusLiteral,
} from '@idol/shared';
import { loadThread, markThreadReadByAdmin, toChatMessages } from '@/lib/contact-thread';
import { ContactRowActions } from '../contact-row-actions';

export const metadata: Metadata = { title: 'お問い合わせ | Super Admin' };
export const dynamic = 'force-dynamic';

export default async function SuperAdminContactThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdminView();
  const { id } = await params;

  const [thread, meta] = await Promise.all([
    loadThread(id),
    prisma.contactMessage.findUnique({
      where: { id },
      select: {
        category: true,
        adminNote: true,
        ackMailSent: true,
        ackMailError: true,
        user: { select: { memberNumber: true } },
      },
    }),
  ]);
  if (!thread || !meta) notFound();

  const marked = await markThreadReadByAdmin(id);
  if (marked > 0) {
    const now = new Date();
    for (const r of thread.replies) if (r.sender === 'MEMBER' && !r.adminReadAt) r.adminReadAt = now;
  }

  const isMember = Boolean(thread.userId);

  return (
    <div className="space-y-5">
      <header>
        <Link href="/super-admin/contact" className="text-xs text-slate-500 hover:underline">
          ← お問い合わせ一覧
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone="info">{CONTACT_STATUS_LABELS[thread.status as ContactStatusLiteral]}</Badge>
          <Badge tone="gray">{CONTACT_CATEGORY_LABELS[meta.category as ContactCategoryLiteral]}</Badge>
          <span className="font-mono text-xs font-semibold text-slate-500">
            {formatContactTicketNumber(thread.ticketNumber)}
          </span>
        </div>
        <h1 className="mt-1 text-xl font-bold text-slate-800">{thread.subject}</h1>
        <p className="mt-1 text-xs text-slate-500">
          {thread.name}（
          <a href={`mailto:${thread.email}`} className="underline hover:text-rose-600">
            {thread.email}
          </a>
          ）
          {meta.user?.memberNumber && (
            <span className="ml-2 font-mono text-slate-400">会員番号: {meta.user.memberNumber}</span>
          )}
          {!isMember && <span className="ml-2 text-amber-600">（ゲスト送信: 返信はメールでのみ届きます）</span>}
        </p>
      </header>

      {thread.ticketNumber && !meta.ackMailSent && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold">送信者への控えメールを送信できていません</p>
          {meta.ackMailError && <p className="mt-1 break-all">理由: {meta.ackMailError}</p>}
        </div>
      )}

      <ContactChat
        viewer="ADMIN"
        initialMessages={toChatMessages(thread, 'ADMIN')}
        fetchUrl={`/api/super-admin/contact/${thread.id}/thread`}
        postUrl={`/api/super-admin/contact/${thread.id}/reply`}
        canPost
        maxLength={CONTACT_REPLY_MAX}
        placeholder="会員への返信を入力 (メールでも届きます)"
        showMarkResolved
        guestNotice={
          isMember ? undefined : 'ゲスト送信のため、返信はメールでのみ届きます (チャット画面はありません)'
        }
      />

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-700">対応状況・管理メモ</h2>
        </CardHeader>
        <CardBody>
          <ContactRowActions contactId={thread.id} status={thread.status} adminNote={meta.adminNote} />
        </CardBody>
      </Card>
    </div>
  );
}
