/**
 * POST /api/super-admin/totp/setup
 *   - SUPER_ADMIN 限定: TOTP (Google Authenticator) のセットアップを開始する
 *
 * 新しい Base32 シークレットを生成し、暗号化して DB に保存する
 * (この時点では totpEnabled=false のまま。/totp/verify で初回コード確認が
 *  取れて初めて有効化される)。
 *
 * QRコード (data URL) と手動入力用の Base32 シークレットをレスポンスで返す。
 * 既に totpEnabled=true の場合は先に /totp/disable での無効化を要求する
 * (有効化中に無断で上書きされる事故を防ぐ)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { generateTotpSecret, encryptTotpSecret, generateTotpQrCodeDataUrl } from '@/lib/totp';

export const runtime = 'nodejs';

export const POST = handle(async () => {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw errors.notFound();

  if (user.totpEnabled) {
    throw errors.conflict('既にTOTPが有効化されています。無効化してからやり直してください');
  }

  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret);
  const qrCodeDataUrl = await generateTotpQrCodeDataUrl(secret, user.email);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecret: encrypted,
      // セットアップ開始 (再開) 時点ではまだ有効化しない。バックアップコードも
      // /verify で初回コード確認が取れてから発行し直す (再セットアップで前のコードが
      // 無効化されることを明示するため、ここでは一旦クリアしておく)。
      totpEnabled: false,
      totpVerifiedAt: null,
      totpBackupCodes: [],
    },
  });

  await logAudit({
    userId: user.id,
    action: 'auth.totp_setup_started',
  });

  return NextResponse.json({
    secret,
    qrCodeDataUrl,
    accountEmail: user.email,
  });
});
