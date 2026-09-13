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

    // 誕生日メール自動送信のアプリ内タイマー (OS cron の冗長系)。
    //   - 本番のみ (dev/test でタイマーが常駐すると HMR やテスト終了を妨げるため)。
    //   - デモモードは DB 接続が無い / モックのため対象外。
    //   - ビルド時 (next build 実行中の register() 呼び出し) は絶対に起動しない。
    //     Next.js は `next build` 中にも instrumentation を評価することがあり、
    //     ここでタイマーを張るとビルドプロセスが終了しなくなる事故につながる。
    if (env.isProduction && !env.demoMode && process.env.NEXT_PHASE !== 'phase-production-build') {
      const { startBirthdayMailScheduler } = await import('./lib/birthday-scheduler');
      startBirthdayMailScheduler();
    }
  }
}
