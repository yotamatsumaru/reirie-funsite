/**
 * POST /api/super-admin/totp/verify
 *   - SUPER_ADMIN 限定: /totp/setup で発行したシークレットに対する初回コード確認
 *
 * body: { code: string } (6桁数字)
 *
 * 確認に成功すると totpEnabled=true になり、以後のログインで TOTP コードが必須になる。
 * このタイミングで初めてバックアップコード (リカバリコード) を生成し、平文を
 * レスポンスで一度だけ返す (DB には scrypt ハッシュのみ保存)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { TotpVerifySchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { decryptTotpSecret, verifyTotpToken, generateBackupCodes } from '@/lib/totp';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw errors.notFound();

  if (user.totpEnabled) {
    throw errors.conflict('既にTOTPが有効化されています');
  }
  if (!user.totpSecret) {
    throw errors.badRequest('先にセットアップ (QRコード発行) を行ってください');
  }

  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = TotpVerifySchema.safeParse(body);
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const secret = decryptTotpSecret(user.totpSecret);
  const ok = verifyTotpToken(secret, parsed.data.code);
  if (!ok) {
    await logAudit({ userId: user.id, action: 'auth.totp_setup_verify_failed' });
    throw errors.badRequest('確認コードが正しくありません。認証アプリの時刻設定もご確認ください');
  }

  const { plain, hashed } = generateBackupCodes();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpEnabled: true,
      totpVerifiedAt: new Date(),
      totpBackupCodes: hashed,
    },
  });

  await logAudit({
    userId: user.id,
    action: 'auth.totp_enabled',
    metadata: { backupCodesIssued: plain.length },
  });

  return NextResponse.json({
    ok: true,
    backupCodes: plain,
  });
});
