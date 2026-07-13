/**
 * 404 ページ。存在しない URL や notFound() が呼ばれたときに表示される。
 */
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'ページが見つかりません' };

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-16 text-center">
      <div className="text-6xl font-black text-brand-500">404</div>
      <h1 className="mt-4 text-xl font-bold text-slate-800">
        ページが見つかりません
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        お探しのページは移動または削除された可能性があります。
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          トップへ戻る
        </Link>
        <Link
          href="/me/rewards"
          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          景品交換へ
        </Link>
      </div>
    </div>
  );
}
