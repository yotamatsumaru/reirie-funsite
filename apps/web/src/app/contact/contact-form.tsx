'use client';

import { useState } from 'react';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  CONTACT_MESSAGE_MAX,
  type ContactCategoryLiteral,
} from '@idol/shared';

export function ContactForm({
  defaultName = '',
  defaultEmail = '',
}: {
  defaultName?: string;
  defaultEmail?: string;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [category, setCategory] = useState<ContactCategoryLiteral>('GENERAL');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 送信完了後に表示する受付番号と、控えメールを送れたかどうか。
  // 会員様からの「届いているか分からない」というご要望に応えるため、
  // 完了画面でも番号を明示し、控えメールの送信結果を正直に伝える。
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [ackMailSent, setAckMailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, category, subject, message }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          json?.error?.message ?? '送信に失敗しました。時間をおいて再度お試しください。',
        );
      }
      setTicketNumber(typeof json?.ticketNumber === 'string' ? json.ticketNumber : null);
      setAckMailSent(json?.ackMailSent === true);
      setSent(true);
      toast.success('お問い合わせを送信しました');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const copyTicket = async () => {
    if (!ticketNumber) return;
    try {
      await navigator.clipboard.writeText(ticketNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('コピーできませんでした。番号を手動で控えてください。');
    }
  };

  if (sent) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
        <p className="text-center text-lg font-bold text-emerald-800">送信が完了しました</p>
        <p className="mt-2 text-center text-sm text-emerald-700">
          お問い合わせありがとうございます。内容を確認のうえ、担当者よりご連絡いたします。
        </p>

        {ticketNumber && (
          <div className="mt-4 rounded-lg border border-emerald-300 bg-white p-4 text-center">
            <p className="text-xs font-semibold tracking-wider text-emerald-700">受付番号</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-wide text-emerald-900">
              {ticketNumber}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              お問い合わせの状況を確認される際は、この番号をお知らせください。
            </p>
            <button
              type="button"
              onClick={copyTicket}
              className="mt-3 rounded-full border border-emerald-300 px-4 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              {copied ? 'コピーしました' : '受付番号をコピー'}
            </button>
          </div>
        )}

        {/*
          控えメールの送信結果を正直に出し分ける。
          「控えを送りました」と書いたのに届かないのが最も不信感につながるため、
          送れなかった場合は受付番号を控えていただくようご案内する。
        */}
        {ackMailSent ? (
          <p className="mt-4 text-center text-sm text-emerald-700">
            <span className="font-semibold">{email}</span> 宛に、送信内容の控えメールをお送りしました。
            <br />
            運営からの返信も、このメールアドレス宛にお送りします。
          </p>
        ) : (
          <p className="mt-4 rounded-md bg-amber-50 p-3 text-center text-sm text-amber-800">
            お問い合わせは正しく受け付けましたが、控えメールの送信ができませんでした。
            <br />
            お手数ですが上記の受付番号をお控えください。運営からの返信は
            <span className="font-semibold">{email}</span> 宛にお送りします。
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Input
        label="お名前"
        name="name"
        required
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        label="メールアドレス"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint="ご返信先のメールアドレスをご入力ください（送信内容の控えメールもこちらに届きます）"
      />
      <Select
        label="お問い合わせ種別"
        name="category"
        value={category}
        onChange={(e) => setCategory(e.target.value as ContactCategoryLiteral)}
      >
        {CONTACT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CONTACT_CATEGORY_LABELS[c]}
          </option>
        ))}
      </Select>
      <Input
        label="件名"
        name="subject"
        required
        maxLength={120}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <Textarea
        label="お問い合わせ内容"
        name="message"
        required
        rows={7}
        maxLength={CONTACT_MESSAGE_MAX}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        hint={`${message.length} / ${CONTACT_MESSAGE_MAX} 文字`}
      />
      {error && (
        <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
      )}
      <Button type="submit" loading={loading} className="w-full" size="lg">
        送信する
      </Button>
    </form>
  );
}
