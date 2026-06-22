'use client';

/**
 * シリアルコード引換フォーム (client component)。
 *
 * - 入力中は大文字に自動変換、4 文字ごとにハイフン補助 (視覚的)。
 *   送信時はサーバ側で再正規化されるので、ハイフンは送ってよい。
 * - エラー表示は API のエラーメッセージをそのまま出す。
 * - 引換成功時は /call/events/[id]/waiting にハードリダイレクトする
 *   (待機室は server component なのでハードリダイレクトのほうが確実)。
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

function formatForDisplay(raw: string): string {
  const compact = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  // 4 文字ごとにハイフン (最大 16 文字までフォーマット)
  return compact.match(/.{1,4}/g)?.slice(0, 4).join('-') ?? '';
}

export function RedeemForm() {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/call/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? '引換に失敗しました');
        setSubmitting(false);
        return;
      }
      const eventId = data?.event?.id as string | undefined;
      if (eventId) {
        // 待機室に遷移
        window.location.href = `/call/events/${eventId}/waiting`;
      } else {
        setError('レスポンスが不正です。サポートまでお問い合わせください');
        setSubmitting(false);
      }
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        name="code"
        label="シリアルコード"
        placeholder="ABCD-1234-EFGH"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        value={code}
        onChange={(e) => setCode(formatForDisplay(e.target.value))}
        hint="ハイフン・小文字・全角は自動で整形されます"
        error={error ?? undefined}
        disabled={submitting}
      />
      <Button type="submit" loading={submitting} disabled={submitting || code.length === 0}>
        引換する
      </Button>
    </form>
  );
}
