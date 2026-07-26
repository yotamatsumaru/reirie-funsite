/**
 * POST /api/super-admin/birthday/test
 *   誕生日メールのテスト送信。
 *   body: { year: number, to: string, name?: string }
 *     - 指定年のテンプレートを、任意のメールアドレスへ 1 通だけ送る。
 *     - 配信記録 (BirthdayMailDelivery) は作成しないため、マイページにも出ない。
 *     - 件名の先頭に [テスト] が付く。
 *
 * SUPER_ADMIN 限定 (送信操作のため STAFF 不可)。
 */
import { NextResponse } from 'next/server';
import { BirthdayMailTestSendSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendBirthdayTestMail } from '@/lib/birthday-mail';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const parsed = BirthdayMailTestSendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }
  const { year, to, name } = parsed.data;

  try {
    await sendBirthdayTestMail({ year, to, name });
  } catch (e) {
    throw errors.badRequest(e instanceof Error ? e.message : 'テスト送信に失敗しました');
  }

  await logAudit({
    userId: session.user.id,
    action: 'birthday.test',
    resource: `birthday:${year}`,
    metadata: { year, to, name: name ?? null },
  });

  return NextResponse.json({ ok: true });
});
