/**
 * POST /api/cron/birthday-mail
 *   誕生日メールの自動送信を実行する (冪等)。
 *
 * 呼び出し方は 2 通り:
 *   1. cron から     : ヘッダ `x-cron-secret: $CRON_SECRET` を付けて叩く。
 *                      EC2 の crontab が 5 分おきに localhost を叩く運用
 *                      (deploy/user-data.sh の crontab 設定を参照)。
 *   2. 管理者から     : ログイン済み ADMIN / SUPER_ADMIN の Cookie でも叩ける
 *                      (動作確認用)。`{"force": true}` を付けると時刻ゲートと
 *                      「本日実行済み」判定を無視して即実行する。
 *
 * 【なぜ 5 分おきに叩く設計なのか】
 *   AWS EventBridge や別の常駐スケジューラを増やさずに、既存の EC2 + PM2 構成の
 *   ままで実現するため。送信時刻は DB (AppSetting) に持たせ、エンドポイント側で
 *   「設定時刻を過ぎた最初の 1 回だけ送る」ようにしてある。これにより管理画面から
 *   時刻を変更しても、cron の設定 (= 再デプロイ) は一切不要。
 *
 * 【重要】「送信すべきでなかった」場合も 200 を返す。時刻前 (not-due) や
 * 本日実行済み (already-ran) は正常系であり、cron のログをエラーで埋めないため。
 * 実際に何が起きたかは status / message で判別できる。
 */
import { NextResponse } from 'next/server';
import { resolveApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { env } from '@/lib/env';
import { logAudit } from '@/lib/audit';
import { runBirthdayMailAutoSend } from '@/lib/birthday-mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  // --- 認証: cron secret もしくは管理者 -----------------------------------
  const cronSecret = req.headers.get('x-cron-secret');
  const validCron = Boolean(cronSecret && env.cron?.secret && cronSecret === env.cron.secret);

  let adminUserId: string | null = null;
  if (!validCron) {
    const session = await resolveApiSession(req);
    const role = session?.user?.role;
    if (!session?.user?.id || (role !== 'ADMIN' && role !== 'SUPER_ADMIN')) {
      throw errors.forbidden('Cron secret もしくは管理者権限が必要です');
    }
    adminUserId = session.user.id;
  }

  // --- force フラグ (管理者のみ) -----------------------------------------
  // cron からの force は事故 (毎回送信されてしまう) につながるため受け付けない。
  const body = (await req.json().catch(() => null)) as { force?: unknown } | null;
  const force = !validCron && body?.force === true;

  const outcome = await runBirthdayMailAutoSend({ force });

  // 「何もしなかった」正常系 (時刻前 / 本日実行済み) は監査ログに残さない。
  // 5 分おきに叩かれるため、残すと audit_logs が単調に膨らんでしまう。
  const noisy = outcome.status === 'not-due' || outcome.status === 'already-ran';
  if (!noisy) {
    await logAudit({
      userId: adminUserId,
      action: 'birthday.auto_send',
      resource: `birthday:${outcome.today.year}`,
      metadata: {
        via: validCron ? 'cron' : 'admin',
        force,
        status: outcome.status,
        date: `${outcome.today.year}-${outcome.today.month}-${outcome.today.day}`,
        scheduledAt: `${outcome.schedule.hour}:${String(outcome.schedule.minute).padStart(2, '0')}`,
        sent: outcome.result?.sent ?? 0,
        skipped: outcome.result?.skipped ?? 0,
        failed: outcome.result?.failed ?? 0,
      },
    }).catch(() => {});
  }

  return NextResponse.json(
    {
      ok: true,
      status: outcome.status,
      message: outcome.message,
      today: outcome.today,
      now: outcome.now,
      schedule: outcome.schedule,
      // エラー配列は先頭 20 件までに切る (cron のログを膨らませない)。
      result: outcome.result
        ? { ...outcome.result, errors: outcome.result.errors.slice(0, 20) }
        : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
