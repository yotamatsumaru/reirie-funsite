/**
 * /api/admin-invite/[token]
 *
 *  GET  : 招待の状態確認（受諾ページ表示用）— 認証不要
 *  POST : 招待の受諾 — 新規 / 既存ユーザー両対応
 *
 *  受諾ロジック:
 *   - 既存ユーザー (email 一致):
 *       ・ログイン済みかつ本人 → その場でロール昇格
 *       ・未ログイン → ログインを要求 (requiresLogin)
 *   - 新規ユーザー:
 *       ・displayName + password を受け取りアカウント作成 + ロール付与
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/password';
import { AcceptAdminInvitationSchema, USER_ROLE_LABELS } from '@idol/shared';
import { isInvitationAcceptable } from '@/lib/admin-invitation';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ token: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { token } = await ctx.params;

  const invitation = await prisma.adminInvitation.findUnique({ where: { token } });
  if (!invitation) {
    return NextResponse.json({ valid: false, reason: 'NOT_FOUND' });
  }

  const acceptable = isInvitationAcceptable(invitation);
  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, deletedAt: true },
  });

  return NextResponse.json({
    valid: acceptable && !existingUser?.deletedAt,
    reason: acceptable ? null : invitation.status === 'PENDING' ? 'EXPIRED' : invitation.status,
    email: invitation.email,
    role: invitation.role,
    roleLabel: USER_ROLE_LABELS[invitation.role],
    isExistingUser: !!existingUser,
    expiresAt: invitation.expiresAt,
  });
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = AcceptAdminInvitationSchema.safeParse({ ...body, token });
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }
  const { displayName, password } = parsed.data;

  const invitation = await prisma.adminInvitation.findUnique({ where: { token } });
  if (!invitation) throw errors.notFound('招待が見つかりません');
  if (!isInvitationAcceptable(invitation)) {
    // 期限切れの場合は状態を更新しておく
    if (invitation.status === 'PENDING' && invitation.expiresAt.getTime() <= Date.now()) {
      await prisma.adminInvitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
    }
    throw errors.badRequest('この招待は有効期限切れ、または無効です');
  }

  const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });

  // ---- 既存ユーザー ----
  if (existingUser) {
    if (existingUser.deletedAt) {
      throw errors.badRequest('このアカウントは利用できません');
    }
    const session = await auth();
    if (!session?.user?.id || session.user.email !== invitation.email) {
      // 本人がログインしていない → ログインを促す
      return NextResponse.json(
        { ok: false, requiresLogin: true, email: invitation.email },
        { status: 401 },
      );
    }

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: existingUser.id },
        data: { role: invitation.role },
      }),
      prisma.adminInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: existingUser.id },
      }),
    ]);

    await logAudit({
      userId: existingUser.id,
      action: 'admin.invitation.accept',
      resource: `adminInvitation:${invitation.id}`,
      metadata: { email: invitation.email, role: invitation.role, mode: 'existing' },
    });

    return NextResponse.json({
      ok: true,
      mode: 'existing',
      role: updated.role,
    });
  }

  // ---- 新規ユーザー ----
  if (!displayName || !password) {
    throw errors.unprocessable('新規アカウント作成にはニックネームとパスワードが必要です', {
      fields: ['displayName', 'password'],
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    // レース条件対策: 直前に同 email が作られていないか再確認
    const dup = await tx.user.findUnique({ where: { email: invitation.email } });
    if (dup) {
      throw errors.conflict('このメールアドレスは既に登録されています。ログインして承認してください。');
    }
    const user = await tx.user.create({
      data: {
        email: invitation.email,
        passwordHash: hashPassword(password),
        displayName,
        role: invitation.role,
        // 招待経由のため、メール到達は招待時点で確認済みとみなす
        emailVerified: new Date(),
      },
    });
    await tx.adminInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user.id },
    });
    return user;
  });

  await logAudit({
    userId: created.id,
    action: 'admin.invitation.accept',
    resource: `adminInvitation:${invitation.id}`,
    metadata: { email: invitation.email, role: invitation.role, mode: 'new' },
  });

  return NextResponse.json({
    ok: true,
    mode: 'new',
    role: created.role,
    email: created.email,
  });
});
