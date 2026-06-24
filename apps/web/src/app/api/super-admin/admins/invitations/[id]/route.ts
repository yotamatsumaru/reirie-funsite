/**
 * /api/super-admin/admins/invitations/[id]
 *
 *  DELETE          : 招待を取消 (PENDING → REVOKED)
 *  POST { resend } : 招待メールを再送（有効期限を延長し、必要ならトークン再発行）
 *
 * いずれも SUPER_ADMIN 限定。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendAdminInvitationEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { USER_ROLE_LABELS } from '@idol/shared';
import { generateInvitationToken, invitationExpiresAt } from '@/lib/admin-invitation';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const session = await requireSuperAdmin();
  const { id } = await ctx.params;

  const invitation = await prisma.adminInvitation.findUnique({ where: { id } });
  if (!invitation) throw errors.notFound('招待が見つかりません');
  if (invitation.status !== 'PENDING') {
    throw errors.badRequest('招待中のものだけ取消できます');
  }

  await prisma.adminInvitation.update({
    where: { id },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.invitation.revoke',
    resource: `adminInvitation:${id}`,
    metadata: { email: invitation.email },
  });

  return NextResponse.json({ ok: true });
});

export const POST = handle(async (_req: Request, ctx: Ctx) => {
  // 再送。期限を延長し、トークンを再発行して送り直す。
  const session = await requireSuperAdmin();
  const { id } = await ctx.params;

  const invitation = await prisma.adminInvitation.findUnique({ where: { id } });
  if (!invitation) throw errors.notFound('招待が見つかりません');
  if (invitation.status === 'ACCEPTED') {
    throw errors.badRequest('受諾済みの招待は再送できません');
  }
  if (invitation.status === 'REVOKED') {
    throw errors.badRequest('取消済みの招待は再送できません');
  }

  // 受諾予定ロールに既に到達している既存ユーザーは再送不要
  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existing?.role === invitation.role) {
    throw errors.conflict(`このユーザーはすでに ${USER_ROLE_LABELS[invitation.role]} です`);
  }

  const token = generateInvitationToken();
  const expiresAt = invitationExpiresAt();

  await prisma.adminInvitation.update({
    where: { id },
    data: { token, expiresAt, status: 'PENDING', revokedAt: null },
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.invitation.resend',
    resource: `adminInvitation:${id}`,
    metadata: { email: invitation.email },
  });

  const acceptUrl = `${env.appBaseUrl}/admin-invite/${token}`;
  await sendAdminInvitationEmail({
    to: invitation.email,
    acceptUrl,
    roleLabel: USER_ROLE_LABELS[invitation.role],
    isExistingUser: !!existing,
    expiresAt,
    note: invitation.note,
  });

  return NextResponse.json({ ok: true, expiresAt });
});
