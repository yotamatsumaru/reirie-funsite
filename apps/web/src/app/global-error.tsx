'use client';

/**
 * グローバルエラーバウンダリ。
 *
 * ルートレイアウト (layout.tsx) 自体のレンダリングが失敗したときの最終フォールバック。
 * ここは layout をバイパスするため、自前で <html>/<body> を描画する必要がある。
 */
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            'system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif',
          background: '#f8fafc',
          color: '#1e293b',
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: 420 }}>
          <div style={{ fontSize: '3rem' }}>🙏</div>
          <h1 style={{ marginTop: '1rem', fontSize: '1.25rem', fontWeight: 700 }}>
            ページを表示できませんでした
          </h1>
          <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#64748b' }}>
            一時的な問題が発生しました。もう一度お試しください。
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.625rem 1.25rem',
              borderRadius: '0.375rem',
              border: 'none',
              background: '#c263a2',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            もう一度読み込む
          </button>
        </div>
      </body>
    </html>
  );
}
