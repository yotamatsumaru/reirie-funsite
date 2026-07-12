/**
 * GET /api/super-admin/totp/status
 *   - SUPER_ADMIN 限定: 自分自身の TOTP (2段階認証) 有効化状況を取得する
 *
 * setup/verify の途中 (シークレット発行済みだが確認コード未入力) と、
 * 有効化完了後 (totpEnabled=true) を区別できるようにする。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw errors.notFound();

  return NextResponse.json({
    enabled: !!user.totpEnabled,
    // セットアップ中 (シークレット発行済みだが確認未完了) かどうか
    pendingSetup: !user.totpEnabled && !!user.totpSecret,
    verifiedAt: user.totpVerifiedAt ?? null,
    // デモモードの fixture には totpBackupCodes が存在しない場合があるため防御的に処理する
    backupCodesRemaining: Array.isArray(user.totpBackupCodes) ? user.totpBackupCodes.length : 0,
  });
});
