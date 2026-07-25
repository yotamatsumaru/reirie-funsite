/**
 * PATCH /api/super-admin/contact/[id] — お問い合わせの対応状況・管理メモを更新 (SUPER_ADMIN 限定)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ContactUpdateSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireSuperAdmin();
  const { id } = await ctx.params;
  const body = await req.json();
  const input = ContactUpdateSchema.parse(body);

  if (input.status === undefined && input.adminNote === undefined) {
    throw errors.badRequest('更新する項目がありません');
  }

  const existing = await prisma.contactMessage.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw errors.notFound('お問い合わせが見つかりません');

  const updated = await prisma.contactMessage.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}),
    },
    select: { id: true, status: true },
  });

  await logAudit({
    userId: session.user.id,
    action: 'contact.update',
    resource: 'contact_messages',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: {
      contactId: id,
      status: input.status ?? null,
      noteUpdated: input.adminNote !== undefined,
    },
  });

  return NextResponse.json({ ok: true, id: updated.id, status: updated.status });
});
