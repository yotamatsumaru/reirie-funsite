/**
 * PATCH /api/super-admin/users/[id]
 *   - SUPER_ADMIN 限定: ロール変更 / BAN / 復活
 *
 * body 例:
 *   { role: 'ADMIN' | 'USER' | 'SUPER_ADMIN' }
 *   { banned: true, banReason: '規約違反のため' }
 *   { banned: false }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { USER_ROLES } from '@idol/shared';

export const runtime = 'nodejs';

const PatchSchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    banned: z.boolean().optional(),
    // BAN 実行時の理由 (任意入力だが、ゴミ箱 UI での確認用に保存する)
    banReason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.role !== undefined || v.banned !== undefined, {
    message: 'role か banned のいずれかを指定してください',
  });

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;

    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
    }
    const { role, banned, banReason } = parsed.data;

    // 自分自身のロール降格・BAN は禁止 (安全装置)
    if (id === session.user.id) {
      if (role && role !== 'SUPER_ADMIN') {
        throw errors.badRequest('自分自身のロールは変更できません');
      }
      if (banned === true) {
        throw errors.badRequest('自分自身を BAN することはできません');
      }
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw errors.notFound('ユーザーが見つかりません');

    const updateData: Record<string, unknown> = {};
    const auditMeta: Record<string, unknown> = { targetUserId: id };

    if (role && role !== target.role) {
      updateData.role = role;
      auditMeta.role = { from: target.role, to: role };
    }
    if (banned === true && !target.deletedAt) {
      const now = new Date();
      updateData.deletedAt = now;
      // 運営による BAN であることを区別するため bannedAt/banReason も記録する。
      // (deletedAt は自己都合の退会でも使われる共通フィールドのため)
      updateData.bannedAt = now;
      updateData.banReason = banReason && banReason.length > 0 ? banReason : null;
      auditMeta.banned = true;
      auditMeta.banReason = updateData.banReason;
    }
    if (banned === false && target.deletedAt) {
      updateData.deletedAt = null;
      // bannedAt/banReason はクリアしない (ゴミ箱 UI で直近の BAN 理由を
      // 履歴として確認できるようにするため、意図的に残す)
      auditMeta.restored = true;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ ok: true, noChange: true });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    await logAudit({
      userId: session.user.id,
      action: banned === true ? 'user.ban' : banned === false ? 'user.restore' : 'user.role.update',
      resource: `user:${id}`,
      metadata: auditMeta,
    });

    return NextResponse.json({ ok: true, user: { id: updated.id, role: updated.role } });
  },
);
