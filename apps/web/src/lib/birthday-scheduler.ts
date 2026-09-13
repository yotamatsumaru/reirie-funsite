/**
 * 誕生日メール自動送信の「アプリ内タイマー」冗長系。
 *
 * 【解決したい不具合】
 *   本来の送信トリガーは EC2 の OS cron (deploy/install-cron.sh が
 *   /etc/cron.d/idol-fansite に登録し、5 分おきに /api/cron/birthday-mail を
 *   curl する) だった。しかし OS cron はアプリの外側にある仕組みのため、
 *     - デプロイ/サーバー再構築時に install-cron.sh の再実行を忘れる
 *     - crond サービスが落ちる / crontab が何らかの理由で消える
 *     - CRON_SECRET が .env.production とずれて認証エラーになる
 *   といった事態が起きても、アプリのログにも監査ログにも一切残らず、
 *   「テンプレートも会員データも有料プランも全て正しいのに、12:00 になっても
 *   静かに送信されない」という、原因究明が非常に難しい不具合になっていた。
 *   (実際に会員から「自動送信のはずなのに届かない」との報告があった。)
 *
 * 【対策】
 *   OS cron に加えて、Next.js サーバープロセス自身の中で setInterval により
 *   定期的に runBirthdayMailAutoSendAndAudit() を直接関数呼び出しする。
 *   これは HTTP を経由しないため CRON_SECRET 不整合の影響を受けず、
 *   「アプリプロセスが起動している」という一点だけが前提条件になる
 *   (PM2 の autorestart が効いていれば、この前提はほぼ常に満たされる)。
 *
 *   実際の送信可否判定・二重送信防止 (claim / advisory lock /
 *   BirthdayMailDelivery のユニーク制約) は runBirthdayMailAutoSend 側に
 *   既にあるものをそのまま利用するため、OS cron とこのタイマーが同時に
 *   動いても多重送信は起きない。両者は「トリガーの経路を増やす」だけの
 *   関係にある。
 *
 * 【なぜチェック間隔を 1 分にしたのか】
 *   OS cron (5 分おき) より短くすることで、こちらが「主系」として先に
 *   12:00:0x を検出できるようにしている。cron 側が正常でも、どちらが
 *   先に claim できるかは早い方が勝つだけで問題ない (2 重に走っても
 *   claim できるのは 1 プロセスだけ)。
 *
 * 呼び出し方: instrumentation.ts の register() から、本番かつ
 * サーバーランタイム (ビルド時ではない) のときに 1 度だけ startBirthdayMailScheduler()
 * を呼ぶ。
 */

const CHECK_INTERVAL_MS = 60_000; // 1 分

declare global {
  // eslint-disable-next-line no-var
  var __birthdayMailSchedulerStarted: boolean | undefined;
}

/**
 * アプリ内タイマーを起動する (プロセスにつき 1 回だけ)。
 *
 * 【多重起動防止】Next.js の dev サーバー (HMR) や、instrumentation.ts が
 * 何らかの理由で複数回評価された場合に setInterval が重複登録されるのを防ぐため、
 * globalThis にフラグを立てて冪等化する。
 */
export function startBirthdayMailScheduler(): void {
  const g = globalThis as typeof globalThis & { __birthdayMailSchedulerStarted?: boolean };
  if (g.__birthdayMailSchedulerStarted) return;
  g.__birthdayMailSchedulerStarted = true;

  const tick = async () => {
    try {
      // 動的 import: instrumentation.ts の実行時点ではまだ Prisma / DB 接続の
      // 準備が整っていない可能性があるため、実際にタイマーが発火したタイミングで
      // 遅延読み込みする (birthday-mail.ts 自体は起動時に読み込んでも副作用は無いが、
      // 依存先を含めて起動シーケンスへの影響を最小化する意図で統一している)。
      const { runBirthdayMailAutoSendAndAudit } = await import('./birthday-mail');
      await runBirthdayMailAutoSendAndAudit({ via: 'scheduler' });
    } catch (e) {
      // タイマー内の例外でプロセスを落とさない。次の tick でリトライされる。
      // eslint-disable-next-line no-console
      console.error('[birthday-scheduler] tick failed', e);
    }
  };

  // eslint-disable-next-line no-console
  console.log(
    `[birthday-scheduler] started (interval=${CHECK_INTERVAL_MS}ms) — OS cron の冗長系として、` +
      'このプロセスが起きている限り誕生日メール送信時刻のチェックを行います。',
  );

  // 起動直後にも 1 回実行する。デプロイ直後の再起動が 12:00 の直後だった場合、
  // 次の 1 分待たずに追いつけるようにするため。
  void tick();
  const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  // Node プロセスの通常終了 (テスト実行等) を妨げないようにする。
  timer.unref?.();
}
