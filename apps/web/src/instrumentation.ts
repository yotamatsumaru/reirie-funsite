/**
 * Next.js instrumentation hook — サーバー起動時に一度だけ実行される。
 * 本番環境で開発用デフォルトシークレットのまま起動していないかを検証し、
 * 該当する場合は起動を失敗させる (フェイルセーフ)。
 *
 * see: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionSecrets } = await import('./lib/env');
    assertProductionSecrets();
  }
}
