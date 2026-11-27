'use client';

/**
 * お問い合わせのチャット表示 (会員・運営で共用)。
 *
 *  - メッセージを吹き出しで時系列に表示 (自分 = 右、相手 = 左)
 *  - 画面を開いている間は一定間隔で新着を取り込む (タブが裏にあるときは止める)
 *  - Enter で改行、Ctrl/Cmd + Enter で送信
 *
 * 本文はプレーンテキストとして描画する (LinkifiedText で URL だけリンク化)。
 * HTML としては扱わないので XSS の心配はない。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LinkifiedText } from '@/components/ui/LinkifiedText';
import { formatJstDateTime } from '@idol/shared';

export type ChatMessageView = {
  id: string;
  sender: 'ADMIN' | 'MEMBER';
  body: string;
  createdAt: string;
  authorLabel: string;
  readByOther: boolean;
  isInitial: boolean;
  emailSent: boolean | null;
  emailError: string | null;
};

type ThreadResponse = {
  thread: { status: string; canPost?: boolean };
  messages: ChatMessageView[];
};

/** 新着の取り込み間隔 */
const POLL_MS = 10_000;

export function ContactChat({
  viewer,
  initialMessages,
  fetchUrl,
  postUrl,
  canPost: initialCanPost,
  maxLength,
  placeholder,
  closedNotice,
  /** 運営側のみ: 送信後に「対応済み」にするかのチェックボックスを出す */
  showMarkResolved = false,
  /** 運営側のみ: ゲスト送信の問い合わせ (メールでのみ届く) */
  guestNotice,
  onStatusChange,
}: {
  viewer: 'MEMBER' | 'ADMIN';
  initialMessages: ChatMessageView[];
  fetchUrl: string;
  postUrl: string;
  canPost: boolean;
  maxLength: number;
  placeholder: string;
  closedNotice?: string;
  showMarkResolved?: boolean;
  guestNotice?: string;
  onStatusChange?: (status: string) => void;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [canPost, setCanPost] = useState(initialCanPost);
  const [body, setBody] = useState('');
  const [markResolved, setMarkResolved] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastCount = useRef(initialMessages.length);

  const mine = viewer;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(fetchUrl, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) return;
      const data = (await res.json()) as ThreadResponse;
      setMessages(data.messages);
      if (typeof data.thread.canPost === 'boolean') setCanPost(data.thread.canPost);
      onStatusChange?.(data.thread.status);
    } catch {
      // 通信できないときは次回に任せる
    }
  }, [fetchUrl, onStatusChange]);

  // 表示中だけ定期的に新着を取り込む
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    start();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // 新しいメッセージが増えたら一番下へ
  useEffect(() => {
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, []);

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(showMarkResolved ? { body: text, markResolved } : { body: text }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        emailSent?: boolean;
        emailError?: string | null;
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(j.error?.message ?? `送信できませんでした (HTTP ${res.status})`);
        return;
      }
      setBody('');
      if (viewer === 'ADMIN' && j.emailSent === false) {
        setNotice(
          `返信は保存しましたが、メールの送信に失敗しました${j.emailError ? `（${j.emailError}）` : ''}`,
        );
      }
      await refresh();
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex max-h-[60vh] min-h-[240px] flex-col gap-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4"
        aria-live="polite"
      >
        {messages.map((m) => {
          const isMine = m.sender === mine;
          return (
            <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] sm:max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                <div className="mb-1 flex items-center gap-2 px-1 text-[11px] text-slate-500">
                  <span className="font-semibold">{m.authorLabel}</span>
                  {m.isInitial && (
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
                      最初のお問い合わせ
                    </span>
                  )}
                </div>
                <div
                  className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                    isMine
                      ? 'rounded-br-sm bg-brand-600 text-white [&_a]:text-white [&_a]:underline'
                      : m.sender === 'ADMIN'
                        ? 'rounded-bl-sm border border-brand-100 bg-white text-slate-800'
                        : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'
                  }`}
                >
                  <LinkifiedText text={m.body} />
                </div>
                <div className="mt-1 flex items-center gap-2 px-1 text-[11px] text-slate-400">
                  <time dateTime={m.createdAt}>{formatJstDateTime(m.createdAt)}</time>
                  {isMine && m.readByOther && <span className="text-brand-500">既読</span>}
                  {viewer === 'ADMIN' && m.sender === 'ADMIN' && m.emailSent === false && (
                    <span className="text-rose-500" title={m.emailError ?? undefined}>
                      メール未送信
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {canPost ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          {guestNotice && <p className="mb-2 text-[11px] text-amber-600">{guestNotice}</p>}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={3}
            maxLength={maxLength}
            disabled={sending}
            placeholder={placeholder}
            aria-label="メッセージ"
            className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:opacity-60"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || body.trim().length === 0}
              className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {sending ? '送信中…' : '送信'}
            </button>
            {showMarkResolved && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={markResolved}
                  onChange={(e) => setMarkResolved(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                送信後に「対応済み」にする
              </label>
            )}
            <span className="text-[11px] text-slate-400">Ctrl / ⌘ + Enter でも送信できます</span>
            <span className="ml-auto text-[11px] text-slate-400">
              {body.length} / {maxLength}
            </span>
          </div>
          {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
          {notice && <p className="mt-2 text-xs text-amber-600">{notice}</p>}
        </div>
      ) : (
        closedNotice && (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {closedNotice}
          </p>
        )
      )}
    </div>
  );
}
