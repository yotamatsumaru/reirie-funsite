'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';

interface PerformerOption {
  id: string;
  label: string;
}

export function CreateEventForm({ performers }: { performers: PerformerOption[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [performerId, setPerformerId] = useState(performers[0]?.id ?? '');
  const [startsAt, setStartsAt] = useState('');
  const [perFanSeconds, setPerFanSeconds] = useState('60');
  const [noticeText, setNoticeText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/call/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          performerId,
          startsAt: new Date(startsAt).toISOString(),
          perFanSeconds: Number(perFanSeconds),
          noticeText: noticeText || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '作成に失敗しました');
      }
      const j = await res.json();
      router.push(`/admin/call/events/${j.event.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラー');
    } finally {
      setLoading(false);
    }
  }

  if (performers.length === 0) {
    return (
      <p className="text-sm text-rose-600">
        演者として指定可能な ADMIN ユーザーが存在しません。先に管理者ユーザーを作成してください。
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Input
        label="タイトル"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        maxLength={120}
        placeholder="例: 1stシングル発売記念 特典会"
      />
      <Select
        label="演者 (アイドル)"
        value={performerId}
        onChange={(e) => setPerformerId(e.target.value)}
        required
      >
        {performers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="開始日時"
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          required
        />
        <Input
          label="1人あたりの秒数"
          type="number"
          min={15}
          max={600}
          value={perFanSeconds}
          onChange={(e) => setPerFanSeconds(e.target.value)}
          required
        />
      </div>
      <Textarea
        label="待機室に表示する注意事項 (任意・文字ベース)"
        value={noticeText}
        onChange={(e) => setNoticeText(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder="例: ・撮影/録音は禁止です ・呼ばれたら「本ルームへ入室」を押してください"
      />
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" loading={loading}>
          イベントを作成
        </Button>
      </div>
    </form>
  );
}
