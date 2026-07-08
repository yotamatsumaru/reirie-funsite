/**
 * DELETE /api/contents/comments/[id]
 *   - コメント削除 (本人 or 管理者のみ)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const DELETE = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const session = await requireApiSession(req);

    const comment = await prisma.contentComment.findUnique({ where: { id } });
    if (!comment) throw errors.notFound('コメントが見つかりません');

    const isOwner = comment.userId === session.user.id;
    const isAdmin = session.user.role === 'ADMIN' || session.user.role === 'SUPER_ADMIN';
    if (!isOwner && !isAdmin) {
      throw errors.forbidden('自分のコメントのみ削除できます');
    }

    await prisma.contentComment.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
);
