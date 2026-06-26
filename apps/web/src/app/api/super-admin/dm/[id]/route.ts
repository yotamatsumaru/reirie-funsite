/**
 * PATCH /api/super-admin/dm/[id] — DM を既読にする (status=READ)
 *
 * SUPER_ADMIN 限定。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const PATCH = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    await requireSuperAdmin();
    const { id } = await ctx.params;

    const existing = await prisma.directMessage.findUnique({ where: { id } });
    if (!existing) throw errors.notFound('メッセージが見つかりません');

    const updated = await prisma.directMessage.update({
      where: { id },
      data: { status: 'READ', readAt: new Date() },
      select: { id: true, status: true, readAt: true },
    });

    return NextResponse.json({ ok: true, message: updated });
  },
);
