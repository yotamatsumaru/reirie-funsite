'use client';

/**
 * マイページ: 運営からの返信 (お問い合わせへの回答) の表示セクション。
 *
 *  - 自分が送ったお問い合わせへの運営返信をカードで表示。
 *  - 未読のものには「NEW」バッジ。開いたら既読 API を叩く。
 *  - 誕生日メールセクションと同じ見た目・既読管理で一貫性を持たせる。
 */
import { useState } from 'react';
import { Mail } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { LinkifiedText } from '@/components/ui/LinkifiedText';
import { formatJstDateTime } from '@idol/shared';

export type ContactReplyItem = {
  id: string;
  subject: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export function ContactReplySection({ replies }: { replies: ContactReplyItem[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-brand-600"
          >
            <Mail className="h-4 w-4" />
          </span>
          <h2 className="text-lg font-semibold">運営からのお知らせ</h2>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-slate-500">
          お問い合わせへの運営からの回答です。
        </p>
        {replies.map((r) => (
          <ContactReplyCard key={r.id} reply={r} />
        ))}
      </CardBody>
    </Card>
  );
}

function ContactReplyCard({ reply }: { reply: ContactReplyItem }) {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(Boolean(reply.readAt));

  async function toggle() {
    const next = !open;
    setOpen(next);
    // 初めて開いたときに既読化
    if (next && !read) {
      setRead(true);
      try {
        await fetch('/api/me/contact-reply/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replyId: reply.id }),
        });
      } catch {
        // 既読化失敗は表示に影響しないため黙って無視
      }
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50/60 to-white">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-slate-800">
            Re: {reply.subject}
          </span>
          {!read && <Badge tone="brand">NEW</Badge>}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
          {formatJstDateTime(reply.createdAt)}
          <span aria-hidden>{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-brand-100 bg-white px-4 py-4">
          {/*
            返信本文はプレーンテキスト。運営が案内 URL を書くケースが多いので
            LinkifiedText で自動リンク化する。
            (dangerouslySetInnerHTML は使わないので XSS の心配は無い。
             このブロックは <button> の兄弟要素なので <a> の入れ子にもならない)
          */}
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
            <LinkifiedText text={reply.body} />
          </p>
          <p className="mt-4 text-right text-xs text-slate-400">— REIRIE 運営より</p>
        </div>
      )}
    </div>
  );
}
