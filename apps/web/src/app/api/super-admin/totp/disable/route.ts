/**
 * POST /api/super-admin/totp/disable
 *   - SUPER_ADMIN 限定: TOTP (2段階認証) を無効化する
 *
 * 誤操作・乗っ取り時の悪用防止のため、現在のパスワードの再入力を必須とする
 * (退会 (/api/me DELETE) と同様のパターン)。
 * 無効化するとシークレット・バックアップコードは完全に削除される
 * (再度有効化する場合は /totp/setup からやり直しになる)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { TotpDisableSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { verifyPassword } from '@/lib/password';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw errors.notFound();

  if (!user.totpEnabled && !user.totpSecret) {
    throw errors.conflict('TOTPは有効化されていません');
  }

  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = TotpDisableSchema.safeParse(body);
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  // デモモードではパスワード検証をスキップする (auth.ts / credentials.ts と同様)
  if (!env.demoMode) {
    if (!verifyPassword(parsed.data.password, user.passwordHash)) {
      throw errors.badRequest('パスワードが正しくありません');
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpEnabled: false,
      totpSecret: null,
      totpVerifiedAt: null,
      totpBackupCodes: [],
    },
  });

  await logAudit({ userId: user.id, action: 'auth.totp_disabled' });

  return NextResponse.json({ ok: true });
});
