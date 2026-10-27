'use client';

/**
 * お知らせ作成 / 編集フォームの「チケットサイトの申込タグ」入力欄。
 *
 * Ticket Dive の主催者画面で発行される「ルート限定タグ」(HTML) をそのまま貼り付ける。
 *  - 貼った瞬間にサニタイズ結果のプレビューを出す (公開後と同じ見た目)
 *  - 使えない部分 (script / 許可外のリンク先 等) があれば、その場で理由を表示する
 *    → 「貼ったのにボタンが出ない」を公開前に気付けるようにする
 * 実際の保存時もサーバーで同じサニタイズを行う (lib/ticket-embed.ts)。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import { TicketEmbed } from '@/components/ui/TicketEmbed';
import {
  sanitizeTicketEmbed,
  TICKET_EMBED_ALLOWED_DOMAINS,
  TICKET_EMBED_MAX_LENGTH,
} from '@/lib/ticket-embed';

export function TicketEmbedField({
  id,
  value,
  onChange,
  disabled,
  origin,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** 自サイトの origin (Ticket Dive 側に登録するアクセス元の案内に使う) */
  origin?: string;
}) {
  // 既にタグが入っている (編集時) なら最初から開いておく
  const [open, setOpen] = useState(value.trim().length > 0);
  const result = useMemo(() => sanitizeTicketEmbed(value), [value]);
  const hasInput = value.trim().length > 0;

  return (
    <div className="rounded-md border border-violet-200 bg-violet-50/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="text-xs font-semibold text-violet-900">
          🎫 チケットサイトの申込タグを埋め込む（Ticket Dive のルート限定タグ等・任意）
          {hasInput && (
            <span className="ml-2 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">
              設定あり
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-violet-700 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div id={`${id}-panel`} className="space-y-3 border-t border-violet-200 px-3 py-3">
          <div className="text-[11px] leading-relaxed text-slate-600">
            <p>
              Ticket Dive の主催者画面で発行された HTML タグを
              <span className="font-semibold">そのまま貼り付けてください</span>。
              お知らせ本文の下に申込ボタンとして表示されます。
            </p>
            <p className="mt-1">
              使えるのは{' '}
              <code className="rounded bg-white px-1">{TICKET_EMBED_ALLOWED_DOMAINS.join(', ')}</code>{' '}
              宛てのリンク・ボタン・フォーム・埋め込み (iframe) です。
              スクリプト (&lt;script&gt;) や他サイト宛てのリンクは、安全のため自動で取り除かれます。
            </p>
            {origin ? (
              <p className="mt-1">
                Ticket Dive 側でアクセス元 (設置サイト) を指定する場合は{' '}
                <code className="rounded bg-white px-1">{origin.replace(/\/$/, '')}/</code>{' '}
                を登録してください。
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor={id} className="sr-only">
              チケットサイトの申込タグ (HTML)
            </label>
            <textarea
              id={id}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              rows={4}
              maxLength={TICKET_EMBED_MAX_LENGTH}
              spellCheck={false}
              placeholder={'例: <a href="https://ticketdive.com/event/xxxx?...">FC先行のお申し込みはこちら</a>'}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <div className="mt-1 flex items-center justify-between">
              {hasInput ? (
                <button
                  type="button"
                  onClick={() => onChange('')}
                  disabled={disabled}
                  className="text-[11px] font-semibold text-slate-500 underline hover:text-slate-700"
                >
                  タグを削除
                </button>
              ) : (
                <span />
              )}
              <span className="text-[10px] text-slate-400">
                {value.length} / {TICKET_EMBED_MAX_LENGTH}
              </span>
            </div>
          </div>

          {hasInput && result.removed.length > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
              <div className="text-[11px] leading-relaxed text-amber-900">
                <p className="font-bold">安全のため、次の部分は取り除かれます</p>
                <ul className="mt-1 list-disc pl-4">
                  {result.removed.map((r) => (
                    <li key={r} className="break-all">
                      {r}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  下のプレビューで申込ボタンが正しく表示されているか確認してください。
                  表示されない場合は、Ticket Dive で発行されたタグをもう一度コピーし直してください。
                </p>
              </div>
            </div>
          )}

          {hasInput && (
            <div>
              <p className="text-[11px] font-semibold text-slate-600">表示プレビュー（公開後と同じ見た目）</p>
              <div className="mt-1 rounded-md border border-slate-200 bg-white px-3 py-4">
                {result.html ? (
                  // プレビュー内のボタンを押して誤って申込ページへ飛ばないよう無効化する
                  <div className="pointer-events-none">
                    <TicketEmbed html={result.html} />
                  </div>
                ) : (
                  <p className="text-xs text-rose-600">
                    表示できる内容がありません（すべて取り除かれました）。
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
