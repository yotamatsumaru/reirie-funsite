'use client';

/**
 * 配信対象のセレクトボックス (新規作成フォーム / 編集フォームで共用)
 *
 * 共通化した理由:
 *   選択肢を片方のフォームだけ直す事故が起きやすい
 *   (実際に「作成では選べるのに編集では選べない」状態になりやすい)。
 *   選択肢そのものは lib/announcement-audience.ts の
 *   ANNOUNCEMENT_AUDIENCES / AUDIENCE_LABELS から生成するので、
 *   配信対象を増やすときはそのファイルだけ直せば両フォームに反映される。
 *
 * 選んだ対象の説明文をその場に出すのは、
 * 「スタンダード会員以上」がプレミアム会員にも届くことを
 * 運営が迷わず判断できるようにするため。
 */

import {
  ANNOUNCEMENT_AUDIENCES,
  AUDIENCE_DESCRIPTIONS,
  AUDIENCE_LABELS,
  type AnnouncementAudienceLiteral,
} from '@/lib/announcement-audience';

export function AudienceSelect({
  id,
  value,
  onChange,
  disabled,
  className,
}: {
  id: string;
  value: AnnouncementAudienceLiteral;
  onChange: (next: AnnouncementAudienceLiteral) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700">
        配信対象
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as AnnouncementAudienceLiteral)}
        disabled={disabled}
        className={
          className ??
          'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'
        }
      >
        {ANNOUNCEMENT_AUDIENCES.map((a) => (
          <option key={a} value={a}>
            {AUDIENCE_LABELS[a]}
          </option>
        ))}
      </select>
      {/* 選択中の対象が「誰に届くのか」を明示して取り違えを防ぐ */}
      <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
        {AUDIENCE_DESCRIPTIONS[value]}
      </p>
    </div>
  );
}
