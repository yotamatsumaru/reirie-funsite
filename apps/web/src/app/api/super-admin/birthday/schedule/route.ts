/**
 * 誕生日メールの自動送信スケジュールの取得・更新。
 *
 *   GET   /api/super-admin/birthday/schedule  — 現在の設定 + 最終実行状況を取得
 *   PATCH /api/super-admin/birthday/schedule  — 設定を部分更新 (enabled / hour / minute)
 *
 * GET は STAFF も閲覧可。PATCH は SUPER_ADMIN 限定 (書き込み操作)。
 */
import { NextResponse } from 'next/server';
import { BirthdayMailScheduleUpdateSchema, formatBirthdayMailTime } from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  getBirthdayMailSchedule,
  setBirthdayMailSchedule,
  getBirthdayMailRunState,
} from '@/lib/app-setting';
import { jstToday, jstNowTime } from '@/lib/birthday-mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const [schedule, runState] = await Promise.all([
    getBirthdayMailSchedule(),
    getBirthdayMailRunState(),
  ]);
  return NextResponse.json(
    {
      schedule,
      runState,
      // サーバーの JST 現在時刻も返す。管理画面で「あと何時間で送信されるか」の
      // 説明に使い、端末のタイムゾーンがずれていても誤解が生じないようにする。
      today: jstToday(),
      now: jstNowTime(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const parsed = BirthdayMailScheduleUpdateSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  // undefined のフィールドは「変更しない」。パッチに混ぜると
  // BirthdayMailScheduleSchema の default で意図せず上書きされてしまうため除去する。
  const patch: { enabled?: boolean; hour?: number; minute?: number } = {};
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.hour !== undefined) patch.hour = parsed.data.hour;
  if (parsed.data.minute !== undefined) patch.minute = parsed.data.minute;

  const { before, after } = await setBirthdayMailSchedule(patch);

  await logAudit({
    userId: session.user.id,
    action: 'birthday.schedule_update',
    resource: 'birthday-schedule',
    metadata: {
      before: { ...before, at: formatBirthdayMailTime(before) },
      after: { ...after, at: formatBirthdayMailTime(after) },
    },
  });

  return NextResponse.json({ ok: true, schedule: after });
});
