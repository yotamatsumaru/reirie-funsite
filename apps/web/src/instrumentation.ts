/**
 * Next.js instrumentation hook — サーバー起動時に一度だけ実行される。
 * 本番環境で開発用デフォルトシークレットのまま起動していないかを検証し、
 * 該当する場合は起動を失敗させる (フェイルセーフ)。
 *
 * see: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionSecrets, isPlaceholderSesFrom, env } = await import('./lib/env');
    assertProductionSecrets();

    // 本番で SES 送信元が未設定 / ダミーのままだと、メール送信時に SES が
    // MessageRejected を返す。起動時点で気付けるよう警告を出す
    // (メール機能は必須ではないため throw はしない)。
    if (env.isProduction && isPlaceholderSesFrom()) {
      // eslint-disable-next-line no-console
      console.warn(
        `[warning] SES_FROM_EMAIL が未設定/ダミー (${env.ses.fromEmail}) のままです。` +
          ' AWS SES で検証済みの送信元アドレスを設定しないと、メール送信は必ず失敗します。',
      );
    }
  }
}
