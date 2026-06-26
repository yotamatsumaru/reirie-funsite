'use client';

/**
 * DM 管理画面クライアント。
 *  - NG ワードをカンマ / 改行区切りで編集・保存。
 *  - 受信 DM を一覧表示し、既読化できる。
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/stores/ui-store';

interface AdminDm {
  id: string;
  body: string;
  senderName: string | null;
  status: 'SENT' | 'READ' | 'REPLIED';
  createdAt: string;
  user: { id: string; displayName: string | null; memberNumber: string | null };
}

interface Props {
  initial: {
    ngWords: string[];
    unreadCount: number;
    messages: AdminDm[];
  };
}

const STATUS_LABEL: Record<AdminDm['status'], { label: string; tone: 'gray' | 'success' | 'brand' }> = {
  SENT: { label: '未読', tone: 'brand' },
  READ: { label: '既読', tone: 'gray' },
  REPLIED: { label: '返信済み', tone: 'success' },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function DmAdminClient({ initial }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<AdminDm[]>(initial.messages);
  const [ngText, setNgText] = useState(initial.ngWords.join('\n'));
  const [savedNg, setSavedNg] = useState(initial.ngWords.join('\n'));
  const [savingNg, startNgTransition] = useTransition();

  const handleSaveNg = () => {
    const ngWords = ngText
      .split(/[\n,、，]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    startNgTransition(async () => {
      try {
        const res = await fetch('/api/super-admin/dm-ng-words', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ngWords }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error?.message ?? '保存に失敗しました');
        const saved = (data.ngWords as string[]).join('\n');
        setNgText(saved);
        setSavedNg(saved);
        toast.success('NG ワードを保存しました');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '保存に失敗しました');
      }
    });
  };

  const handleMarkRead = (id: string) => {
    void (async () => {
      try {
        const res = await fetch(`/api/super-admin/dm/${id}`, { method: 'PATCH' });
        if (!res.ok) throw new Error('既読化に失敗しました');
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, status: 'READ' as const } : m)),
        );
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '既読化に失敗しました');
      }
    })();
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">💌 DM 管理</h1>
        {initial.unreadCount > 0 && <Badge tone="brand">未読 {initial.unreadCount}</Badge>}
      </header>

      {/* NG ワード設定 */}
      <Card>
        <CardHeader>
          <h2 className="font-bold text-slate-900">NG ワード設定</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-slate-600">
            改行 / カンマ区切りで登録します。<strong>部分一致</strong>でブロックされます
            (例:「シネ」を登録すると「シネマ」も送信不可)。
          </p>
          <textarea
            rows={5}
            value={ngText}
            onChange={(e) => setNgText(e.target.value)}
            placeholder={'死ね\nシネ\n...'}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
          <div className="flex justify-end">
            <Button onClick={handleSaveNg} loading={savingNg} disabled={ngText === savedNg}>
              NG ワードを保存
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* 受信一覧 */}
      <Card>
        <CardHeader>
          <h2 className="font-bold text-slate-900">受信した DM</h2>
        </CardHeader>
        <CardBody>
          {messages.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">まだ DM はありません。</p>
          ) : (
            <ul className="space-y-3">
              {messages.map((m) => {
                const s = STATUS_LABEL[m.status];
                return (
                  <li key={m.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">
                          {m.senderName || m.user.displayName || '名無し'}
                        </span>
                        {m.user.memberNumber && (
                          <span className="ml-2 text-slate-400">{m.user.memberNumber}</span>
                        )}
                        <span className="ml-2">{formatDate(m.createdAt)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={s.tone}>{s.label}</Badge>
                        {m.status === 'SENT' && (
                          <Button size="sm" variant="ghost" onClick={() => handleMarkRead(m.id)}>
                            既読にする
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-slate-800">{m.body}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
