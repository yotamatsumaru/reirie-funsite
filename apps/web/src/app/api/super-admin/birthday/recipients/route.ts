/**
 * GET /api/super-admin/birthday/recipients?year=2026&month=&day=
 *   誕生日メールの送信対象者一覧を取得する。
 *   - month/day 省略時は JST の「今日」が誕生日の会員。
 *   - 各会員に、その年 (year) の配信状況 (sent / emailSent / sentAt) を付与。
 *   - 「未送信者」= sent=false または emailSent=false。
 *
 * SUPER_ADMIN 限定 (閲覧は STAFF も可)。
 */
import { NextResponse } from 'next/server';
import { BIRTHDAY_MAIL_YEAR_MIN, BIRTHDAY_MAIL_YEAR_MAX } from '@idol/shared';
import { requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { listBirthdayRecipients, jstToday } from '@/lib/birthday-mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  await requireSuperAdminView();
  const url = new URL(req.url);

  const year = Number(url.searchParams.get('year'));
  if (!Number.isInteger(year) || year < BIRTHDAY_MAIL_YEAR_MIN || year > BIRTHDAY_MAIL_YEAR_MAX) {
    throw errors.badRequest('年 (year) が不正です');
  }

  const monthRaw = url.searchParams.get('month');
  const dayRaw = url.searchParams.get('day');
  const month = monthRaw ? Number(monthRaw) : undefined;
  const day = dayRaw ? Number(dayRaw) : undefined;
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
    throw errors.badRequest('月 (month) が不正です');
  }
  if (day !== undefined && (!Number.isInteger(day) || day < 1 || day > 31)) {
    throw errors.badRequest('日 (day) が不正です');
  }

  const recipients = await listBirthdayRecipients({ year, month, day });
  const today = jstToday();

  return NextResponse.json({
    today,
    target: {
      month: month ?? today.month,
      day: day ?? today.day,
    },
    recipients,
    summary: {
      total: recipients.length,
      sent: recipients.filter((r) => r.sent && r.emailSent).length,
      unsent: recipients.filter((r) => !(r.sent && r.emailSent)).length,
    },
  });
});
