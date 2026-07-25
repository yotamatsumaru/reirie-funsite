/**
 * 法務ページ (利用規約 / プライバシーポリシー / 特定商取引法) 共通レイアウト
 *
 * - サイトのトーン (slate 基調・角丸カード) に合わせた読みやすい体裁を提供する。
 * - 番号付きの見出し・箇条書き・定義リストを扱うためのプリミティブを併せて公開する。
 */
import type { ReactNode } from 'react';

export function LegalPage({
  title,
  lead,
  updatedAt,
  children,
}: {
  title: string;
  lead?: ReactNode;
  /** 「最終改訂日」等の表示 (任意) */
  updatedAt?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8 border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-bold text-slate-800 sm:text-3xl">{title}</h1>
        {lead && (
          <div className="mt-4 text-sm leading-relaxed text-slate-600">{lead}</div>
        )}
        {updatedAt && (
          <p className="mt-4 text-xs text-slate-400">最終改訂日：{updatedAt}</p>
        )}
      </header>
      <div className="space-y-8">{children}</div>
    </main>
  );
}

/** 番号付き（または見出しのみ）のセクション */
export function LegalSection({
  no,
  title,
  children,
}: {
  no?: number | string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-baseline gap-2 text-base font-bold text-slate-800 sm:text-lg">
        {no !== undefined && (
          <span className="inline-flex min-w-[1.6rem] shrink-0 items-center justify-center rounded bg-slate-800 px-1.5 py-0.5 text-xs font-bold text-white">
            {no}
          </span>
        )}
        <span>{title}</span>
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

/** サブ見出し (第◯項の中の小見出し) */
export function LegalSubheading({ children }: { children: ReactNode }) {
  return <h3 className="mt-3 text-sm font-semibold text-slate-700">{children}</h3>;
}

/** 段落 */
export function LegalP({ children }: { children: ReactNode }) {
  return <p className="leading-relaxed text-slate-600">{children}</p>;
}

/** 箇条書き (・) */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5 pl-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 leading-relaxed">
          <span aria-hidden className="mt-[2px] shrink-0 text-twilight-rose">
            ・
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** 番号付きリスト (1. 2. 3.) */
export function LegalOrderedList({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-1.5 pl-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 leading-relaxed">
          <span aria-hidden className="mt-[1px] shrink-0 font-semibold text-slate-500">
            {i + 1}.
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

/** 事業者情報などの定義テーブル (項目名 / 内容) */
export function LegalDefinitionTable({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="overflow-hidden rounded-xl border border-slate-200">
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex flex-col border-b border-slate-100 last:border-b-0 sm:flex-row"
        >
          <dt className="bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700 sm:w-52 sm:shrink-0 sm:text-sm">
            {row.label}
          </dt>
          <dd className="px-4 py-3 text-sm leading-relaxed text-slate-600">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
