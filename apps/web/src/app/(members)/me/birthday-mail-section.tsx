'use client';

/**
 * マイページ: 運営から届いた誕生日メールの表示セクション。
 *
 *  - 年ごとに届いたお祝いメールをカードで表示。
 *  - 未読のものには「NEW」バッジ。開いたら既読 API を叩く。
 *  - 画像 (ヘッダー画像) があればカード上部に表示し、メールと同じ雰囲気に。
 */
import { useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJstDate } from '@idol/shared';

export type BirthdayMailItem = {
  id: string;
  year: number;
  subject: string;
  body: string;
  imageUrl: string | null;
  sentAt: string;
  readAt: string | null;
};

export function BirthdayMailSection({ mails }: { mails: BirthdayMailItem[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-xl">🎂</span>
          <h2 className="text-lg font-semibold">お誕生日メッセージ</h2>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {mails.map((m) => (
          <BirthdayMailCard key={m.id} mail={m} />
        ))}
      </CardBody>
    </Card>
  );
}

function BirthdayMailCard({ mail }: { mail: BirthdayMailItem }) {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(Boolean(mail.readAt));
  const [imageFailed, setImageFailed] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // 初めて開いたときに既読化
    if (next && !read) {
      setRead(true);
      try {
        await fetch('/api/me/birthday-mail/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deliveryId: mail.id }),
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
        <span className="flex items-center gap-2">
          <span className="font-semibold text-slate-800">{mail.year}年 お誕生日メッセージ</span>
          {!read && <Badge tone="brand">NEW</Badge>}
        </span>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {formatJstDate(mail.sentAt)}
          <span aria-hidden>{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-brand-100 bg-white">
          {mail.imageUrl && !imageFailed && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={mail.imageUrl}
              alt=""
              className="max-h-80 w-full object-cover"
              onError={() => setImageFailed(true)}
            />
          )}
          <div className="px-4 py-4">
            <p className="text-base font-bold text-brand-700">{mail.subject}</p>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {mail.body}
            </p>
            <p className="mt-4 text-right text-xs text-slate-400">— REIRIE より</p>
          </div>
        </div>
      )}
    </div>
  );
}
