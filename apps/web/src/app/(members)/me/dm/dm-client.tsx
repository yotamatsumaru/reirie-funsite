'use client';

/**
 * REIRIE への DM クライアント。
 *  - 本文中で "@" を打つと、登録した「呼んでほしい名前」のサジェストが出て挿入できる。
 *  - 送信前にクライアント側でも NG ワード / 長さをチェックしてプレビュー表示。
 *  - 「呼んでほしい名前」もこの画面から更新できる。
 */
import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  checkDirectMessage,
  expandMentions,
  resolvePreferredName,
  DM_MAX_LENGTH,
  PREFERRED_NAME_MAX_LENGTH,
} from '@idol/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/stores/ui-store';

interface DmMessage {
  id: string;
  body: string;
  senderName: string | null;
  status: 'SENT' | 'READ' | 'REPLIED';
  createdAt: string;
}

interface Props {
  initial: {
    preferredName: string;
    resolvedName: string;
    ngWords: string[];
    messages: DmMessage[];
  };
}

const STATUS_LABEL: Record<DmMessage['status'], { label: string; tone: 'gray' | 'success' | 'brand' }> = {
  SENT: { label: '送信済み', tone: 'gray' },
  READ: { label: '既読', tone: 'success' },
  REPLIED: { label: '返信あり', tone: 'brand' },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function DmClient({ initial }: Props) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<DmMessage[]>(initial.messages);
  const [body, setBody] = useState('');
  const [showMention, setShowMention] = useState(false);
  const [pending, startTransition] = useTransition();

  // 呼んでほしい名前
  const [preferredName, setPreferredName] = useState(initial.preferredName);
  const [savedName, setSavedName] = useState(initial.preferredName);
  const [savingName, startNameTransition] = useTransition();

  const resolvedName = useMemo(
    () => resolvePreferredName(savedName, initial.resolvedName),
    [savedName, initial.resolvedName],
  );

  // 送信前チェック (プレビュー)
  const check = useMemo(
    () => checkDirectMessage(body, resolvedName, initial.ngWords),
    [body, resolvedName, initial.ngWords],
  );
  const preview = useMemo(() => expandMentions(body, resolvedName), [body, resolvedName]);

  // "@" を打ったらサジェストを出す
  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setBody(v);
    const caret = e.target.selectionStart ?? v.length;
    const justBefore = v.slice(0, caret);
    setShowMention(justBefore.endsWith('@'));
  };

  // サジェストをクリック → 直近の "@" の後ろに名前を挿入 (= @ を名前に置換)
  const insertMention = () => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret);
    const after = body.slice(caret);
    // 直近の "@" を名前に置換
    const lastAt = before.lastIndexOf('@');
    if (lastAt === -1) {
      setBody(`${before}${resolvedName}${after}`);
    } else {
      setBody(`${before.slice(0, lastAt)}${resolvedName}${after}`);
    }
    setShowMention(false);
    // フォーカスを戻す
    requestAnimationFrame(() => el?.focus());
  };

  const handleSend = () => {
    if (!check.ok) {
      if (check.reason === 'NG_WORD') {
        toast.error(`使用できない言葉が含まれています: ${(check.ngWords ?? []).join(', ')}`);
      } else if (check.reason === 'TOO_LONG') {
        toast.error('メッセージが長すぎます。');
      } else {
        toast.error('メッセージを入力してください。');
      }
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/me/dm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const ng = data?.error?.details?.ngWords as string[] | undefined;
          throw new Error(
            ng?.length
              ? `使用できない言葉が含まれています: ${ng.join(', ')}`
              : (data?.error?.message ?? '送信に失敗しました'),
          );
        }
        const m = data.message as { id: string; body: string; senderName: string | null; createdAt: string };
        setMessages((prev) => [
          { id: m.id, body: m.body, senderName: m.senderName, status: 'SENT', createdAt: m.createdAt },
          ...prev,
        ]);
        setBody('');
        toast.success('REIRIE にメッセージを送りました!');
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '送信に失敗しました');
      }
    });
  };

  const handleSaveName = () => {
    startNameTransition(async () => {
      try {
        const res = await fetch('/api/me/profile/preferred-name', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferredName }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error?.message ?? '保存に失敗しました');
        setSavedName(data.preferredName ?? '');
        toast.success('呼んでほしい名前を保存しました');
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '保存に失敗しました');
      }
    });
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">💌 REIRIE への DM</h1>
        <p className="mt-1 text-sm text-slate-600">
          REIRIE へ応援メッセージを送れます。本文中で <code className="rounded bg-slate-100 px-1">@</code> を打つと、
          あなたの「呼んでほしい名前」を挿入できます。
        </p>
      </header>

      {/* 呼んでほしい名前 */}
      <Card>
        <CardHeader>
          <h2 className="font-bold text-slate-900">呼んでほしい名前</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-slate-600">
            REIRIE にこう呼んでほしい、という名前を登録できます (DM の <code className="rounded bg-slate-100 px-1">@</code> で挿入されます)。
          </p>
          <div className="flex items-end gap-2">
            <Input
              label="名前"
              value={preferredName}
              maxLength={PREFERRED_NAME_MAX_LENGTH}
              placeholder="例: れいちゃん推し"
              onChange={(e) => setPreferredName(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="secondary"
              onClick={handleSaveName}
              loading={savingName}
              disabled={preferredName === savedName}
            >
              保存
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            現在の呼び名: <span className="font-semibold text-slate-700">{resolvedName}</span>
          </p>
        </CardBody>
      </Card>

      {/* メッセージ作成 */}
      <Card>
        <CardHeader>
          <h2 className="font-bold text-slate-900">メッセージを送る</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="relative space-y-1">
            <label htmlFor="dm-body" className="block text-sm font-medium text-slate-700">
              本文
            </label>
            <textarea
              id="dm-body"
              ref={textareaRef}
              rows={4}
              value={body}
              maxLength={DM_MAX_LENGTH + 50}
              placeholder="@ から応援しています!"
              onChange={handleBodyChange}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            />
            {showMention && (
              <button
                type="button"
                onClick={insertMention}
                className="absolute right-2 top-20 z-10 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-sm font-semibold text-brand-700 shadow-md hover:bg-brand-50"
              >
                @ → {resolvedName}
              </button>
            )}
          </div>

          {/* プレビュー & 文字数 */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">
              {body.length} 文字
              {check.ok ? null : check.reason === 'NG_WORD' ? (
                <span className="ml-2 font-semibold text-rose-600">
                  使用できない言葉: {(check.ngWords ?? []).join(', ')}
                </span>
              ) : check.reason === 'TOO_LONG' ? (
                <span className="ml-2 font-semibold text-rose-600">長すぎます</span>
              ) : null}
            </span>
          </div>

          {body.includes('@') && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="mr-1 text-xs font-semibold text-slate-400">プレビュー:</span>
              {preview}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSend} loading={pending} disabled={!check.ok}>
              送信する
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* 送信履歴 */}
      <Card>
        <CardHeader>
          <h2 className="font-bold text-slate-900">送ったメッセージ</h2>
        </CardHeader>
        <CardBody>
          {messages.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">まだメッセージはありません。</p>
          ) : (
            <ul className="space-y-3">
              {messages.map((m) => {
                const s = STATUS_LABEL[m.status];
                return (
                  <li key={m.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-400">{formatDate(m.createdAt)}</span>
                      <Badge tone={s.tone}>{s.label}</Badge>
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
