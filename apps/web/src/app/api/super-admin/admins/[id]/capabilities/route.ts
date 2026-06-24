/**
 * PATCH /api/super-admin/admins/[id]/capabilities
 *   - SUPER_ADMIN 限定: ADMIN ユーザーの管理権限 (adminCapabilities) を更新
 *
 * body: { capabilities: ('CONTENT'|'MERCH'|'GAME'|'CALL')[] }
 *
 * 備考:
 *   - 対象が SUPER_ADMIN の場合は常に全権限を持つため、個別の権限指定は不要 (400)
 *   - 対象が USER の場合は管理者ではないため対象外 (400)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { UpdateAdminCapabilitiesSchema, normalizeAdminCapabilities } from '@idol/shared';

export const runtime = 'nodejs';

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;

    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = UpdateAdminCapabilitiesSchema.safeParse(body);
    if (!parsed.success) {
      throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
    }
    const capabilities = normalizeAdminCapabilities(parsed.data.capabilities);

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw errors.notFound('ユーザーが見つかりません');

    if (target.role === 'SUPER_ADMIN') {
      throw errors.badRequest('スーパー管理者はすべての権限を持つため、個別指定は不要です');
    }
    if (target.role !== 'ADMIN') {
      throw errors.badRequest('管理者ではないユーザーには権限を設定できません');
    }

    const before = normalizeAdminCapabilities(
      (target as unknown as { adminCapabilities?: string[] }).adminCapabilities,
    );

    const updated = await prisma.user.update({
      where: { id },
      data: { adminCapabilities: capabilities } as never,
    });

    await logAudit({
      userId: session.user.id,
      action: 'admin.capabilities.update',
      resource: `user:${id}`,
      metadata: { targetUserId: id, from: before, to: capabilities },
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: updated.id,
        capabilities,
      },
    });
  },
);
