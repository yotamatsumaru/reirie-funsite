/**
 * POST /api/super-admin/admins/grant
 *   - SUPER_ADMIN 限定: 指定メールのユーザーに ADMIN / SUPER_ADMIN を付与
 *
 * body: { email: string, role: 'ADMIN' | 'SUPER_ADMIN' }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { AdminCapabilitySchema, normalizeAdminCapabilities } from '@idol/shared';

export const runtime = 'nodejs';

const Schema = z.object({
  email: z.email(),
  role: z.enum(['ADMIN', 'SUPER_ADMIN']),
  capabilities: z.array(AdminCapabilitySchema).optional(),
});

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }
  const { email, role } = parsed.data;
  // SUPER_ADMIN は全権限のため capabilities は無視
  const capabilities =
    role === 'ADMIN' ? normalizeAdminCapabilities(parsed.data.capabilities ?? []) : [];

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw errors.notFound('指定したメールアドレスのユーザーが見つかりません');
  }
  if (user.deletedAt) {
    throw errors.badRequest('BAN 済みのユーザーには権限を付与できません');
  }
  if (user.role === role) {
    return NextResponse.json({ ok: true, noChange: true });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { role, adminCapabilities: capabilities } as never,
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.grant',
    resource: `user:${user.id}`,
    metadata: { email, from: user.role, to: role, capabilities },
  });

  return NextResponse.json({ ok: true, user: { id: user.id, email, role } });
});
