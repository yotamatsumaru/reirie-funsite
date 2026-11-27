/**
 * /super-admin/contact — お問い合わせ管理 (SUPER_ADMIN / STAFF)
 *
 * 公開フォーム (/contact) から届いたお問い合わせを「最近やり取りがあった順」に一覧表示する。
 * 会員からの未読メッセージがあるものは目印を付け、各行からチャット画面
 * (/super-admin/contact/[id]) で返信・対応状況の変更・管理メモの記録を行う。
 */
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
  CONTACT_CATEGORY_LABELS,
  formatContactTicketNumber,
  type ContactStatusLiteral,
  type ContactCategoryLiteral,
} from '@idol/shared';
import { previewText } from '@/lib/contact-thread';

export const metadata: Metadata = { title: 'お問い合わせ管理 | Super Admin' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<ContactStatusLiteral, 'info' | 'warning' | 'success' | 'gray'> = {
  NEW: 'info',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  CLOSED: 'gray',
};

type ContactReplyRow = {
  sender: 'ADMIN' | 'MEMBER';
  body: string;
  createdAt: Date;
};

type ContactRow = {
  id: string;
  ticketNumber: string | null;
  name: string;
  email: string;
  category: ContactCategoryLiteral;
  subject: string;
  message: string;
  status: ContactStatusLiteral;
  adminNote: string | null;
  createdAt: Date;
  lastMessageAt: Date;
  ackMailSent: boolean;
  ackMailError: string | null;
  adminNotifiedAt: Date | null;
  adminNotifyError: string | null;
  user: { id: string; memberNumber: string | null } | null;
  replies: ContactReplyRow[];
  _count: { replies: number };
};

function formatDateTime(d: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export default async function SuperAdminContactPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const statusFilter = (CONTACT_STATUSES as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as ContactStatusLiteral)
    : '';

  const [messages, newCount, totalCount, ackFailedCount, unreadThreadCount] = await Promise.all([
    prisma.contactMessage.findMany({
      where: statusFilter ? { status: statusFilter } : {},
      include: {
        user: { select: { id: true, memberNumber: true } },
        // 一覧には最後の 1 件だけ (抜粋表示)。全文はチャット画面で見る
        replies: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { sender: true, body: true, createdAt: true },
        },
        // 運営が読んでいない会員メッセージの数
        _count: { select: { replies: { where: { sender: 'MEMBER', adminReadAt: null } } } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 500,
    }) as unknown as Promise<ContactRow[]>,
    prisma.contactMessage.count({ where: { status: 'NEW' } }),
    prisma.contactMessage.count(),
    // 控えメールの送信に失敗した件数 (受付番号あり = 控えメール機能導入後の問い合わせのうち
    // 送信できていないもの)。導入前の旧レコードは ticketNumber が null なので除外する。
    prisma.contactMessage.count({
      where: { ticketNumber: { not: null }, ackMailSent: false },
    }),
    prisma.contactMessage.count({
      where: { replies: { some: { sender: 'MEMBER', adminReadAt: null } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-800">お問い合わせ管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          お問い合わせフォーム（<span className="font-mono">/contact</span>）から届いたメッセージを確認し、
          会員とチャット形式でやり取りします。スタッフ管理者も返信できます。
        </p>
      </header>

      {/* KPI */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">会員からの未読メッセージ</p>
            <p className={`mt-1 text-2xl font-bold ${unreadThreadCount > 0 ? 'text-rose-600' : 'text-slate-800'}`}>
              {unreadThreadCount}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">未対応（NEW）</p>
            <p className={`mt-1 text-2xl font-bold ${newCount > 0 ? 'text-sky-600' : 'text-slate-800'}`}>
              {newCount}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">総件数</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{totalCount}</p>
          </CardBody>
        </Card>
        {/*
          控えメールが送れていない件数。会員には「届いているか分からない」
          状態のままなので、運営が気づけるよう KPI として常時表示する。
          0 件のときは目立たせない。
        */}
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">控えメール未送信</p>
            <p
              className={`mt-1 text-2xl font-bold ${
                ackFailedCount > 0 ? 'text-amber-600' : 'text-slate-800'
              }`}
            >
              {ackFailedCount}
            </p>
            {ackFailedCount > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                送信者に控えが届いていません。各件の理由をご確認ください。
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ステータス絞り込み */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          href="/super-admin/contact"
          className={`rounded-full border px-3 py-1 font-semibold ${
            statusFilter === ''
              ? 'border-rose-300 bg-rose-50 text-rose-700'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          すべて
        </Link>
        {CONTACT_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/super-admin/contact?status=${s}`}
            className={`rounded-full border px-3 py-1 font-semibold ${
              statusFilter === s
                ? 'border-rose-300 bg-rose-50 text-rose-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {CONTACT_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      {/* 一覧 */}
      {messages.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-6 text-center text-sm text-slate-500">お問い合わせはありません。</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <Card key={m.id}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[m.status]}>{CONTACT_STATUS_LABELS[m.status]}</Badge>
                      {m._count.replies > 0 && (
                        <Badge tone="danger">会員から未読 {m._count.replies}</Badge>
                      )}
                      <Badge tone="gray">{CONTACT_CATEGORY_LABELS[m.category]}</Badge>
                      {/* 受付番号。会員が控えメールの番号を伝えてきたときに紐づけるためのキー。 */}
                      <span className="font-mono text-xs font-semibold text-slate-500">
                        {formatContactTicketNumber(m.ticketNumber)}
                      </span>
                      <span className="text-xs text-slate-400">{formatDateTime(m.createdAt)}</span>
                    </div>
                    <h3 className="mt-2 font-semibold text-slate-800">{m.subject}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {m.name}（
                      <a href={`mailto:${m.email}`} className="underline hover:text-rose-600">
                        {m.email}
                      </a>
                      ）
                      {m.user?.memberNumber && (
                        <span className="ml-2 font-mono text-slate-400">
                          会員番号: {m.user.memberNumber}
                        </span>
                      )}
                      {!m.user && <span className="ml-2 text-slate-400">（ゲスト送信）</span>}
                    </p>
                  </div>
                </div>

                <p className="line-clamp-2 text-sm text-slate-600">
                  <span className="mr-1 text-xs font-semibold text-slate-500">
                    {m.replies[0] ? (m.replies[0].sender === 'ADMIN' ? '運営:' : `${m.name}:`) : `${m.name}:`}
                  </span>
                  {previewText(m.replies[0]?.body ?? m.message, 160)}
                </p>

                {/*
                  控えメールの送信結果。正常時は出さない (ノイズを増やさない)。
                  導入前の旧レコード (ticketNumber が null) はそもそも対象外。
                */}
                {m.ticketNumber && !m.ackMailSent && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    送信者への控えメールを送信できていません
                    {m.ackMailError && <span className="ml-1 break-all text-amber-700">（{m.ackMailError}）</span>}
                  </p>
                )}
                {m.ticketNumber && !m.adminNotifiedAt && m.adminNotifyError && (
                  <p className="text-xs text-slate-400">運営への受信通知: {m.adminNotifyError}</p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">
                    最終更新 {formatDateTime(m.lastMessageAt)}
                  </span>
                  <Link
                    href={`/super-admin/contact/${m.id}`}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                  >
                    やり取りを開く・返信する
                  </Link>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {messages.length >= 500 && (
        <p className="text-xs text-amber-600">
          ※ 表示件数の上限 (500件) に達しています。古いお問い合わせは表示されていない可能性があります。
        </p>
      )}
    </div>
  );
}
