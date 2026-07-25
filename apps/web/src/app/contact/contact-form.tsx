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
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '送信に失敗しました。時間をおいて再度お試しください。');
      }
      setSent(true);
      toast.success('お問い合わせを送信しました');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-lg font-bold text-emerald-800">送信が完了しました</p>
        <p className="mt-2 text-sm text-emerald-700">
          お問い合わせありがとうございます。内容を確認のうえ、担当者よりご連絡いたします。
          <br />
          返信は入力いただいたメールアドレス宛にお送りします。
        </p>
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
        hint="ご返信先のメールアドレスをご入力ください"
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
