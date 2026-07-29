/**
 * お問い合わせ行の操作 (Client Component)
 *  - 運営からの返信 (メール通知 + マイページ表示) と返信履歴
 *  - 対応状況の変更
 *  - 管理メモの編集
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
  CONTACT_REPLY_MAX,
  type ContactStatusLiteral,
} from '@idol/shared';

export type ReplyItem = {
  id: string;
  body: string;
  emailSent: boolean;
  emailError: string | null;
  createdAt: string;
  repliedByLabel: string;
};

export function ContactRowActions({
  contactId,
  status,
  adminNote,
  isMember,
  replies,
}: {
  contactId: string;
  status: ContactStatusLiteral;
  adminNote: string | null;
  isMember: boolean;
  replies: ReplyItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(adminNote ?? '');
  const [savedNote, setSavedNote] = useState(adminNote ?? '');

  // 返信フォーム
  const [replyBody, setReplyBody] = useState('');
  const [markResolved, setMarkResolved] = useState(true);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyNotice, setReplyNotice] = useState<string | null>(null);

  function handleSendReply() {
    const body = replyBody.trim();
    if (!body) {
      setReplyError('返信内容を入力してください');
      return;
    }
    setReplyError(null);
    setReplyNotice(null);
    startTransition(async () => {
      const res = await fetch(`/api/super-admin/contact/${contactId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, markResolved }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        emailSent?: boolean;
        emailError?: string | null;
        error?: { message?: string };
      };
      if (!res.ok || !j.ok) {
        setReplyError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      setReplyBody('');
      if (j.emailSent) {
        setReplyNotice('返信を送信し、メールで通知しました');
      } else {
        setReplyNotice(
          `返信は記録しましたが、メール送信に失敗しました${j.emailError ? `（${j.emailError}）` : ''}`,
        );
      }
      router.refresh();
    });
  }

  async function callApi(bodyObj: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/super-admin/contact/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(j.error?.message ?? `HTTP ${res.status}`);
      return false;
    }
    return true;
  }

  function handleStatusChange(next: ContactStatusLiteral) {
    startTransition(async () => {
      const ok = await callApi({ status: next });
      if (ok) router.refresh();
    });
  }

  function handleSaveNote() {
    startTransition(async () => {
      const ok = await callApi({ adminNote: note });
      if (ok) {
        setSavedNote(note);
        router.refresh();
      }
    });
  }

  const noteDirty = note !== savedNote;

  return (
    <div className="space-y-4">
      {/* 返信履歴 */}
      {replies.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">返信履歴</p>
          {replies.map((r) => (
            <div
              key={r.id}
              className="rounded-md border border-brand-100 bg-brand-50/40 px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>{r.repliedByLabel} が返信</span>
                <span className="flex items-center gap-2">
                  {r.emailSent ? (
                    <span className="text-emerald-600">メール送信済み</span>
                  ) : (
                    <span className="text-rose-600" title={r.emailError ?? undefined}>
                      メール未送信
                    </span>
                  )}
                  <span>{r.createdAt}</span>
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* 返信フォーム */}
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-xs font-semibold text-slate-600">運営から返信する</label>
          {!isMember && (
            <span className="text-[11px] text-amber-600">
              ※ ゲスト送信のためメール通知のみ（マイページには表示されません）
            </span>
          )}
        </div>
        <textarea
          value={replyBody}
          disabled={pending}
          rows={3}
          maxLength={CONTACT_REPLY_MAX}
          placeholder="お問い合わせへの回答を入力してください（問い合わせ者へメールで届きます）"
          onChange={(e) => setReplyBody(e.target.value)}
          className="mt-2 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 disabled:opacity-50"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSendReply}
            disabled={pending || replyBody.trim().length === 0}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            返信をメール送信
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={markResolved}
              disabled={pending}
              onChange={(e) => setMarkResolved(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            送信後に「対応済み」にする
          </label>
          {replyError && <span className="text-xs text-rose-600">{replyError}</span>}
          {replyNotice && <span className="text-xs text-emerald-600">{replyNotice}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-500">対応状況</label>
        <select
          value={status}
          disabled={pending}
          onChange={(e) => handleStatusChange(e.target.value as ContactStatusLiteral)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
        >
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CONTACT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <textarea
          value={note}
          disabled={pending}
          rows={2}
          placeholder="管理メモ (対応記録など)"
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSaveNote}
            disabled={pending || !noteDirty}
            className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            メモを保存
          </button>
          {noteDirty && <span className="text-xs text-amber-600">未保存</span>}
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}
