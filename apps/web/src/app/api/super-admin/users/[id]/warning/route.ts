/**
 * /api/super-admin/users/[id]/warning
 *   - SUPER_ADMIN 限定: ファンユーザーへの警告通知 (メール送信のみ、サイト内表示なし)
 *
 * GET  : このユーザーへの警告履歴一覧 (新しい順)
 * POST : 新しい警告を発行する。body: { reason: string }
 *        DB に履歴を保存した上で SES 経由でメール送信する。
 *        メール送信に失敗しても履行済みの履行 (履歴保存) はロールバックしない
 *        (emailSent フラグ / emailError で結果を記録する)。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendWarningEmail } from '@/lib/email';

export const runtime = 'nodejs';

const PostSchema = z.object({
  reason: z.string().trim().min(1, '警告理由を入力してください').max(1000),
});

export const GET = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    await requireSuperAdmin();
    const { id } = await ctx.params;

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw errors.notFound('ユーザーが見つかりません');

    const warnings = await prisma.userWarning.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reason: true,
        emailSent: true,
        emailError: true,
        createdAt: true,
        issuedBy: { select: { id: true, displayName: true, email: true } },
      },
    });

    return NextResponse.json({ warnings });
  },
);

export const POST = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;

    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) {
      throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
    }
    const { reason } = parsed.data;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true },
    });
    if (!target) throw errors.notFound('ユーザーが見つかりません');

    // 先に履歴を保存 (メール送信の成否に関わらず、警告を発行した事実は残す)
    const created = await prisma.userWarning.create({
      data: {
        userId: id,
        reason,
        issuedById: session.user.id,
      },
    });

    let emailSent = false;
    let emailError: string | null = null;
    try {
      await sendWarningEmail({
        to: target.email,
        displayName: target.displayName ?? '',
        reason,
      });
      emailSent = true;
    } catch (err) {
      emailError = err instanceof Error ? err.message : '不明なエラー';
      // eslint-disable-next-line no-console
      console.error('[warning] メール送信に失敗しました', err);
    }

    const updated = await prisma.userWarning.update({
      where: { id: created.id },
      data: { emailSent, emailError },
    });

    await logAudit({
      userId: session.user.id,
      action: 'user.warning',
      resource: `user:${id}`,
      metadata: { targetUserId: id, warningId: created.id, emailSent },
    });

    return NextResponse.json({
      ok: true,
      warning: {
        id: updated.id,
        reason: updated.reason,
        emailSent: updated.emailSent,
        emailError: updated.emailError,
        createdAt: updated.createdAt,
      },
    });
  },
);
