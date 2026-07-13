'use client';

/**
 * ルートエラーバウンダリ。
 *
 * ページのレンダリング (SSR / クライアント) 中に例外が発生した場合に表示される。
 * これが無いと、本番では「This page couldn't load」(真っ黒画面) になり、
 * ユーザーには 404 のように見えてしまうため、必ず用意しておく。
 */
import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 本番のサーバーログに詳細を残す (digest で照合できる)
    console.error('[app-error]', error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-16 text-center">
      <div className="text-5xl">🙏</div>
      <h1 className="mt-4 text-xl font-bold text-slate-800">
        ページを表示できませんでした
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        一時的な問題が発生しました。少し時間をおいて、もう一度お試しください。
      </p>
      {error?.digest && (
        <p className="mt-2 text-[11px] text-slate-400">
          エラーコード: {error.digest}
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          もう一度読み込む
        </button>
        <Link
          href="/"
          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          トップへ戻る
        </Link>
      </div>
    </div>
  );
}
