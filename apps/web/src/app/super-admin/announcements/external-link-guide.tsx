'use client';

/**
 * 外部チケットサイト (LivePocket 等) の「アクセス元制限」設定ガイド
 *
 * なぜ画面に出すか:
 *   LivePocket の専用販売ページには「このサイトから来た人だけ通す」
 *   というアクセス元制限がある。設定値を間違えると
 *   「会員がリンクを押してもエラーページに飛ぶ」という
 *   気付きにくい事故になるため、正しい値をその場で確認できるようにする。
 *
 * 内容の根拠は LivePocket 公式 FAQ (専用販売ページ設定)。
 */

import { useState } from 'react';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import { AnnouncementLinkCopy } from './announcement-link-copy';

export function ExternalLinkGuide({ origin }: { origin: string }) {
  const [open, setOpen] = useState(false);

  // アクセス元は「ドメイン指定推奨」なので末尾スラッシュ付きの origin を出す
  const domainValue = `${origin.replace(/\/$/, '')}/`;

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-sky-900">
          チケットサイト（LivePocket 等）にリンクする場合の設定
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-sky-700 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-sky-200 px-4 py-4">
          <div>
            <p className="text-xs font-bold text-sky-900">
              1. 「アクセス元」に入れる値
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-700">
              LivePocket の「アクセス元のドメインまたはディレクトリ」欄には、
              <span className="font-semibold">ドメイン指定（下の値）を推奨</span>
              しています。
            </p>
            <div className="mt-2">
              <AnnouncementLinkCopy
                url={domainValue}
                label="ドメインをコピー"
                hint="LivePocket 公式もドメイン指定を推奨しています。末尾のスラッシュまで含めてください。"
              />
            </div>
          </div>

          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
            <div className="flex items-start gap-2">
              <TriangleAlert
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
                aria-hidden
              />
              <div className="text-xs leading-relaxed text-amber-900">
                <p className="font-bold">
                  ディレクトリ単位（/notices/ など）はおすすめしません
                </p>
                <p className="mt-1">
                  パスまで指定すると、閲覧者のブラウザ設定によっては
                  アクセス元が読み取れず
                  <span className="font-semibold">
                    「アクセスできません」になる
                  </span>
                  ことがあります。
                </p>
                <p className="mt-1">
                  また、このサイトは会員のプライバシー保護のため
                  <span className="font-semibold">
                    アクセス元としてドメインのみを送信
                  </span>
                  し、ページのパスは送信しません。
                  ディレクトリ単位が必要な場合は開発側の追加対応が必要なので、
                  ご相談ください。
                </p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-sky-900">
              2. このサイト側の対応状況
            </p>
            <ul className="mt-1 space-y-1 text-xs leading-relaxed text-slate-700">
              <li>
                ✅ お知らせ本文の URL は通常のリンク（
                <code className="rounded bg-white px-1">a</code> タグ）で
                生成しています（LivePocket が必須としている条件）。
              </li>
              <li>
                ✅ アクセス元が伝わるよう、リンクの参照元設定を調整済みです。
                お知らせから LivePocket へ問題なく遷移できます。
              </li>
              <li>
                ⚠️ SNS のプロフィール欄やアプリ内ブラウザからの遷移は、
                LivePocket 側の仕様上うまく動かない場合があります。
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
