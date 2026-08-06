'use client';

/**
 * お知らせの編集フォーム (一覧の行内で開閉するインライン編集)
 *
 * 別ページ (/super-admin/announcements/[id]/edit) にしなかった理由:
 *   - 下書きの確認 → 直す → プレビュー、を往復しやすくするため
 *     一覧から離れない形にしている
 *   - 「どの下書きを直しているか」が一覧の文脈のまま分かる
 *
 * 保存は PATCH /api/super-admin/announcements/[id] を使う。
 * 変更したフィールドだけを送る (lib/announcement-edit.ts の
 * diffAnnouncementFields)。全部送るとメールが再送されうるため。
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { LinkifiedText } from '@/components/ui/LinkifiedText';
import { linkify } from '@/lib/linkify';
import {
  BODY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  diffAnnouncementFields,
  hasNoChanges,
  mayTriggerEmailOnEdit,
  validateAnnouncementFields,
  type AnnouncementAudienceLiteral,
  type AnnouncementEditableFields,
  type AnnouncementStatusLiteral,
} from '@/lib/announcement-edit';

type EmailStatus =
  | 'NOT_REQUESTED'
  | 'PENDING'
  | 'SENDING'
  | 'COMPLETED'
  | 'FAILED';

export function AnnouncementEditForm({
  id,
  status,
  emailStatus,
  initial,
  onClose,
}: {
  id: string;
  status: AnnouncementStatusLiteral;
  emailStatus: EmailStatus;
  initial: AnnouncementEditableFields;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [audience, setAudience] = useState<AnnouncementAudienceLiteral>(
    initial.audience,
  );
  const [sendEmail, setSendEmail] = useState(initial.sendEmail);

  const current: AnnouncementEditableFields = {
    title,
    body,
    audience,
    sendEmail,
  };
  const patch = diffAnnouncementFields(initial, current);
  const unchanged = hasNoChanges(patch);

  // 公開済みでメール未送信の状態を編集すると一斉メールが走りうる。
  // 「メールも送信する」を新たに ON にした場合も同じ。
  const emailRisk =
    mayTriggerEmailOnEdit({ status, sendEmail, emailStatus }) ||
    (status === 'PUBLISHED' && sendEmail && !initial.sendEmail);

  function save() {
    setError(null);

    const invalid = validateAnnouncementFields(current);
    if (invalid) {
      setError(invalid);
      return;
    }

    if (unchanged) {
      setError('変更がありません');
      return;
    }

    if (
      emailRisk &&
      !confirm(
        'この内容で保存すると、配信対象の会員へ一斉メールが送信される可能性があります。\n続行しますか？',
      )
    ) {
      return;
    }

    startTransition(async () => {
      const res = await fetch(`/api/super-admin/announcements/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      // 一覧の表示 (タイトル / 本文 / 更新日時) を最新にしてから閉じる
      router.refresh();
      onClose();
    });
  }

  function cancel() {
    // 入力途中の内容を捨てる前に確認する (誤クリックでの消失を防ぐ)
    if (!unchanged && !confirm('編集内容を破棄しますか？')) return;
    onClose();
  }

  const linkCount = linkify(body).filter((t) => t.type === 'link').length;

  return (
    <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-brand-700">
          {status === 'DRAFT' ? '下書きを編集' : '公開中のお知らせを編集'}
        </p>
        {!unchanged && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
            未保存の変更あり
          </span>
        )}
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <label
            htmlFor={`title-${id}`}
            className="block text-xs font-semibold text-slate-700"
          >
            タイトル <span className="text-rose-500">*</span>
          </label>
          <input
            id={`title-${id}`}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending}
            maxLength={TITLE_MAX_LENGTH}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <label
            htmlFor={`body-${id}`}
            className="block text-xs font-semibold text-slate-700"
          >
            本文 <span className="text-rose-500">*</span>
          </label>
          <textarea
            id={`body-${id}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={pending}
            rows={8}
            maxLength={BODY_MAX_LENGTH}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <div className="mt-1 flex items-start justify-between gap-2">
            <p className="text-[10px] text-slate-500">
              URL はそのまま貼れば自動でリンクになります。HTML タグは使えません。
            </p>
            <p className="shrink-0 text-[10px] text-slate-400">
              {body.length} / {BODY_MAX_LENGTH}
            </p>
          </div>

          {body.trim().length > 0 && (
            <details className="mt-2 rounded-md border border-slate-200 bg-white">
              <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold text-slate-600">
                表示プレビュー
                {linkCount > 0 ? (
                  <span className="ml-1 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                    リンク {linkCount} 件
                  </span>
                ) : (
                  <span className="ml-1 text-[10px] font-normal text-slate-400">
                    (リンクは検出されていません)
                  </span>
                )}
              </summary>
              <div className="border-t border-slate-200 px-3 py-3">
                {/* 誤クリック防止のためリンクは無効化 (見た目確認のみ) */}
                <div className="pointer-events-none whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">
                  <LinkifiedText text={body} />
                </div>
              </div>
            </details>
          )}
        </div>

        <div>
          <label
            htmlFor={`audience-${id}`}
            className="block text-xs font-semibold text-slate-700"
          >
            配信対象
          </label>
          <select
            id={`audience-${id}`}
            value={audience}
            onChange={(e) =>
              setAudience(e.target.value as AnnouncementAudienceLiteral)
            }
            disabled={pending}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:max-w-xs"
          >
            <option value="ALL">全ユーザー</option>
            <option value="MEMBERS">会員のみ</option>
            <option value="PREMIUM">PREMIUM 会員のみ</option>
          </select>
        </div>

        {/*
          メール送信フラグ。
          すでに送信完了しているものは再送されないため、
          チェックを触っても実害が無いことを添える。
        */}
        <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            disabled={pending}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span>
            <span className="font-medium">配信対象の会員にメールも送信する</span>
            <br />
            <span className="text-xs text-slate-500">
              {emailStatus === 'COMPLETED'
                ? 'このお知らせは既にメール送信済みです（編集しても再送されません）。'
                : '下書きのままではメールは送信されません。公開時に送信されます。'}
            </span>
          </span>
        </label>

        {emailRisk && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
            <TriangleAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
              aria-hidden
            />
            <p className="text-xs leading-relaxed text-amber-800">
              このまま保存すると、配信対象の会員へ
              <span className="font-bold">一斉メールが送信される可能性があります</span>
              。 文面をよく確認してください。
            </p>
          </div>
        )}

        {error && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || unchanged}
            className="rounded-md bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {pending ? '保存中…' : '変更を保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
