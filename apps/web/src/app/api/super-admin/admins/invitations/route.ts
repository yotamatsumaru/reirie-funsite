/**
 * /api/super-admin/admins/invitations
 *
 *  GET  : 招待一覧 (SUPER_ADMIN)
 *  POST : 新規招待発行 + 招待メール送信 (SUPER_ADMIN)
 *
 * 招待は「新規（アカウント未作成）」「既存ユーザー」の両方に対応する。
 * 既存ユーザーをその場で即時昇格させたい場合は /api/super-admin/admins/grant を使う。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendAdminInvitationEmail } from '@/lib/email';
import { env } from '@/lib/env';
import {
  CreateAdminInvitationSchema,
  USER_ROLE_LABELS,
  normalizeAdminCapabilities,
  type AdminInvitationStatusLiteral,
} from '@idol/shared';
import { generateInvitationToken, invitationExpiresAt } from '@/lib/admin-invitation';

export const runtime = 'nodejs';

/** 期限切れの PENDING を EXPIRED に揃える (遅延更新) */
async function sweepExpired(): Promise<void> {
  await prisma.adminInvitation.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
}

export const GET = handle(async () => {
  await requireSuperAdminView();
  await sweepExpired();

  const invitations = await prisma.adminInvitation.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      invitedBy: { select: { email: true, displayName: true } },
      acceptedBy: { select: { email: true, displayName: true } },
    },
  });

  return NextResponse.json({
    invitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      status: inv.status as AdminInvitationStatusLiteral,
      note: inv.note,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
      createdAt: inv.createdAt,
      invitedBy: inv.invitedBy
        ? { email: inv.invitedBy.email, displayName: inv.invitedBy.displayName }
        : null,
      acceptedBy: inv.acceptedBy
        ? { email: inv.acceptedBy.email, displayName: inv.acceptedBy.displayName }
        : null,
    })),
  });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  await sweepExpired();

  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = CreateAdminInvitationSchema.safeParse(body);
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }
  const { email, role, note } = parsed.data;
  // SUPER_ADMIN は全権限のため capabilities は保存しない
  const capabilities =
    role === 'ADMIN' ? normalizeAdminCapabilities(parsed.data.capabilities) : [];

  // 既存ユーザーの状態確認
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.deletedAt) {
      throw errors.badRequest('BAN 済みのユーザーは招待できません');
    }
    if (existing.role === role) {
      throw errors.conflict(`このユーザーはすでに ${USER_ROLE_LABELS[role]} です`);
    }
  }

  // 既に有効な招待が存在する場合は重複を防ぐ
  const activeInvite = await prisma.adminInvitation.findFirst({
    where: { email, status: 'PENDING', expiresAt: { gt: new Date() } },
  });
  if (activeInvite) {
    throw errors.conflict(
      'このメールアドレスには有効な招待がすでに存在します。再送または取消してください。',
    );
  }

  const token = generateInvitationToken();
  const expiresAt = invitationExpiresAt();

  const invitation = await prisma.adminInvitation.create({
    data: {
      email,
      role,
      capabilities,
      token,
      note: note ?? null,
      invitedById: session.user.id,
      expiresAt,
    } as never,
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.invitation.create',
    resource: `adminInvitation:${invitation.id}`,
    metadata: { email, role, capabilities, isExistingUser: !!existing },
  });

  const acceptUrl = `${env.appBaseUrl}/admin-invite/${token}`;
  await sendAdminInvitationEmail({
    to: email,
    acceptUrl,
    roleLabel: USER_ROLE_LABELS[role],
    isExistingUser: !!existing,
    expiresAt,
    note: note ?? null,
  });

  return NextResponse.json({
    ok: true,
    invitation: { id: invitation.id, email, role, expiresAt },
    isExistingUser: !!existing,
  });
});
