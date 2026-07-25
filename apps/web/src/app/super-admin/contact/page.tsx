/**
 * /super-admin/contact — お問い合わせ管理 (SUPER_ADMIN 限定)
 *
 * 公開フォーム (/contact) から届いたお問い合わせを一覧表示し、
 * 対応状況の更新・管理メモの記録を行う。
 * 未対応 (NEW) 件数を上部に表示し、対応状況で絞り込める。
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
  type ContactStatusLiteral,
  type ContactCategoryLiteral,
} from '@idol/shared';
import { ContactRowActions } from './contact-row-actions';

export const metadata: Metadata = { title: 'お問い合わせ管理 | Super Admin' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<ContactStatusLiteral, 'info' | 'warning' | 'success' | 'gray'> = {
  NEW: 'info',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  CLOSED: 'gray',
};

type ContactRow = {
  id: string;
  name: string;
  email: string;
  category: ContactCategoryLiteral;
  subject: string;
  message: string;
  status: ContactStatusLiteral;
  adminNote: string | null;
  createdAt: Date;
  user: { id: string; memberNumber: string | null } | null;
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

  const [messages, newCount, totalCount] = await Promise.all([
    prisma.contactMessage.findMany({
      where: statusFilter ? { status: statusFilter } : {},
      include: { user: { select: { id: true, memberNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }) as unknown as Promise<ContactRow[]>,
    prisma.contactMessage.count({ where: { status: 'NEW' } }),
    prisma.contactMessage.count(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-800">お問い合わせ管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          お問い合わせフォーム（<span className="font-mono">/contact</span>）から届いたメッセージを確認・対応します。
        </p>
      </header>

      {/* KPI */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                      <Badge tone="gray">{CONTACT_CATEGORY_LABELS[m.category]}</Badge>
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

                <div className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                  {m.message}
                </div>

                <ContactRowActions
                  contactId={m.id}
                  status={m.status}
                  adminNote={m.adminNote}
                />
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
