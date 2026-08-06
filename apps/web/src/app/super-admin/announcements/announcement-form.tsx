'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LinkifiedText } from '@/components/ui/LinkifiedText';
import { linkify } from '@/lib/linkify';

type Audience = 'ALL' | 'MEMBERS' | 'PREMIUM';
type Status = 'DRAFT' | 'PUBLISHED';

export function AnnouncementForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('ALL');
  const [status, setStatus] = useState<Status>('DRAFT');
  const [sendEmail, setSendEmail] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!title.trim() || !body.trim()) {
      setError('タイトルと本文は必須です');
      return;
    }

    startTransition(async () => {
      const res = await fetch('/api/super-admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          audience,
          status,
          sendEmail,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      setTitle('');
      setBody('');
      setAudience('ALL');
      setStatus('DRAFT');
      setSendEmail(false);
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-slate-700">
          タイトル <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          maxLength={200}
          placeholder="例: 【重要】サービス障害のお知らせ"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700">
          本文 <span className="text-rose-500">*</span>
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={pending}
          rows={6}
          maxLength={4000}
          placeholder={
            '改行可。Markdown は使えません。\n' +
            'URL をそのまま書くと自動でリンクになります。\n' +
            '例: 詳細は https://example.com/campaign をご覧ください'
          }
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
        />
        <div className="mt-1 flex items-start justify-between gap-2">
          <p className="text-[10px] leading-relaxed text-slate-500">
            🔗 <span className="font-semibold">URL は自動でリンクになります</span>
            （<code className="rounded bg-slate-100 px-1">https://…</code>、
            <code className="rounded bg-slate-100 px-1">www.…</code>、
            メールアドレス）。
            <br />
            リンクにしたい場合は URL をそのまま貼り付けてください。
            HTML タグは使えません（そのまま文字として表示されます）。
          </p>
          <p className="shrink-0 text-[10px] text-slate-400">
            {body.length} / 4000
          </p>
        </div>

        {/* 本文プレビュー: 実際にどうリンク化されるかを投稿前に確認できる */}
        {body.trim().length > 0 && <BodyLinkPreview body={body} />}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700">
            配信対象
          </label>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as Audience)}
            disabled={pending}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
          >
            <option value="ALL">全ユーザー</option>
            <option value="MEMBERS">会員のみ</option>
            <option value="PREMIUM">PREMIUM 会員のみ</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            ステータス
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            disabled={pending}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
          >
            <option value="DRAFT">下書きとして保存</option>
            <option value="PUBLISHED">すぐに公開</option>
          </select>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            disabled={pending}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
          />
          <span>
            <span className="font-medium">配信対象の会員にメールも送信する</span>
            <br />
            <span className="text-xs text-slate-500">
              「すぐに公開」を選んだ場合のみ、保存と同時に配信対象へ一斉メールを送信します
              (下書き保存中はメールは送信されません)。
            </span>
          </span>
        </label>
      </div>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          ✓ お知らせを作成しました
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {pending
            ? '作成中…'
            : status === 'PUBLISHED'
              ? '公開する'
              : '下書き保存'}
        </button>
      </div>
    </form>
  );
}

/**
 * 本文プレビュー。
 *
 * 投稿前に「どの文字列がリンクになるか」を確認できるようにする。
 * 実際の詳細ページ (/notices/[id]) と同じ <LinkifiedText> を使うので、
 * ここで見えている結果がそのまま公開後の表示になる。
 *
 * - プレビュー内のリンクは踏めてしまうと編集の邪魔になるので、
 *   ラッパー側で pointer-events を切って「見た目だけ」にしている。
 * - 検出件数を出すことで「リンクになっていない」ことに気付きやすくする。
 */
function BodyLinkPreview({ body }: { body: string }) {
  const linkCount = linkify(body).filter((t) => t.type === 'link').length;

  return (
    <details className="mt-2 rounded-md border border-slate-200 bg-slate-50">
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
        {/* プレビュー内のリンクは誤クリック防止のため無効化する */}
        <div className="pointer-events-none whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">
          <LinkifiedText text={body} />
        </div>
      </div>
    </details>
  );
}
