/**
 * POST /api/super-admin/birthday/send
 *   誕生日メールを送信する。
 *   body: { year: number, userIds?: string[], force?: boolean }
 *     - userIds 指定: その会員のみ送信 (個別送信)。
 *     - userIds 省略/空: 「今日が誕生日で、その年に未送信」の全員へ一斉送信。
 *     - force=true: 日付・プランの条件を無視して userIds の会員へ強制送信
 *                   (運営の救済操作)。userIds 必須。送信済みでも再送する。
 *
 * SUPER_ADMIN 限定 (書き込み操作のため STAFF 不可)。
 */
import { NextResponse } from 'next/server';
import {
  BIRTHDAY_MAIL_FORCED_SEND_MAX,
  BirthdayMailSendSchema,
  isValidForcedSendRequest,
  isWithinForcedSendLimit,
} from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendBirthdayMails } from '@/lib/birthday-mail';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const parsed = BirthdayMailSendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }
  const { year, userIds, force } = parsed.data;

  // 強制送信のガード。スキーマだけでは「force=true かつ userIds 省略」を弾けないため、
  // ここで業務ルールとして検証する。これが無いと全会員への誤爆が起こりうる。
  if (!isValidForcedSendRequest({ force, userIds })) {
    throw errors.badRequest('強制送信では送信対象の会員を指定してください');
  }
  if (force && userIds && !isWithinForcedSendLimit(userIds)) {
    throw errors.badRequest(
      `強制送信は一度に ${BIRTHDAY_MAIL_FORCED_SEND_MAX} 名までです`,
    );
  }

  let result;
  try {
    result = await sendBirthdayMails({ year, userIds, force });
  } catch (e) {
    throw errors.badRequest(e instanceof Error ? e.message : '送信に失敗しました');
  }

  // 強制送信は「誰がいつ誰に条件を無視して送ったか」を必ず追跡できるようにする。
  // 通常送信と区別できるよう mode を 'forced' にし、対象 userId も残す。
  await logAudit({
    userId: session.user.id,
    action: force ? 'birthday.force_send' : 'birthday.send',
    resource: `birthday:${year}`,
    metadata: {
      year,
      mode: force ? 'forced' : userIds && userIds.length > 0 ? 'individual' : 'bulk',
      ...(force ? { targetUserIds: userIds } : {}),
      ...result,
    },
  });

  return NextResponse.json({ ok: true, result });
});
