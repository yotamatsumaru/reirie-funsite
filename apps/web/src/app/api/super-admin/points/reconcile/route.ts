/**
 * POST /api/super-admin/points/reconcile — ポイント残高の整合性是正
 *
 * SUPER_ADMIN 限定。指定ユーザーの User.points を台帳 (PointTransaction の合計)
 * に一致させる。バグ・不正・手動 DB 改変などで生じたズレを是正するための操作。
 * 操作内容 (before/after/diff) は監査ログに記録される。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { reconcileUserPoints } from '@/lib/points';

export const runtime = 'nodejs';

const Schema = z.object({ userId: z.string().uuid() });

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('userId を指定してください', parsed.error.flatten());
  }

  const result = await reconcileUserPoints(parsed.data.userId);

  await logAudit({
    userId: session.user.id,
    action: 'points.reconcile',
    resource: `user:${parsed.data.userId}`,
    metadata: result,
  });

  return NextResponse.json({ ok: true, ...result });
});
