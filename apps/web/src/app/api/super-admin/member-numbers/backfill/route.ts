/**
 * GET  /api/super-admin/member-numbers/backfill — 会員番号の採番状況を取得
 * POST /api/super-admin/member-numbers/backfill — 未採番ユーザーへ会員番号を一括採番
 *
 * SUPER_ADMIN 限定。
 *
 * 会員番号は登録時 (signup) と会員カード表示時に採番されるが、その導線を通って
 * いない既存ユーザーには番号が付いていない。POST で番号なしユーザー全員へ、
 * 登録が古い順に連番を採番する (冪等・何度実行しても既存番号は変わらない)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { backfillMemberNumbers } from '@/lib/points';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const [total, withNumber] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { memberNumber: { not: null } } }),
  ]);
  return NextResponse.json({
    total,
    withNumber,
    missing: total - withNumber,
  });
});

export const POST = handle(async () => {
  const session = await requireSuperAdmin();

  const result = await backfillMemberNumbers();

  await logAudit({
    userId: session.user.id,
    action: 'member_number.backfill',
    resource: 'user:member_number',
    metadata: { assigned: result.assigned, alreadyHad: result.alreadyHad },
  });

  return NextResponse.json({
    assigned: result.assigned,
    alreadyHad: result.alreadyHad,
    message:
      result.assigned > 0
        ? `${result.assigned} 名に会員番号を採番しました。`
        : '未採番のユーザーはいませんでした。',
  });
});
