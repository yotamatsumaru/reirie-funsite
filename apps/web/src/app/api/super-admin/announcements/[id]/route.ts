/**
 * PATCH/DELETE /api/super-admin/announcements/[id]
 *   - SUPER_ADMIN 限定: お知らせの更新 / 削除
 *
 * PATCH body: { title?, body?, audience?, status? }
 * DELETE: no body
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  deleteAnnouncement,
  getAnnouncement,
  updateAnnouncement,
} from '@/lib/demo-store';

export const runtime = 'nodejs';

const PatchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().min(1).max(4000).optional(),
    audience: z.enum(['ALL', 'MEMBERS', 'PREMIUM']).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: '更新するフィールドが指定されていません',
  });

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;

    const json = (await req.json().catch(() => ({}))) as unknown;
    const parsed = PatchSchema.safeParse(json);
    if (!parsed.success) {
      throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
    }

    const prev = getAnnouncement(id);
    if (!prev) {
      throw errors.notFound('指定したお知らせが見つかりません');
    }

    const next = updateAnnouncement(id, parsed.data);
    if (!next) {
      throw errors.notFound('お知らせの更新に失敗しました');
    }

    await logAudit({
      userId: session.user.id,
      action: 'announcement.update',
      resource: `announcement:${id}`,
      metadata: {
        changed: parsed.data,
        prevStatus: prev.status,
      },
    });

    return NextResponse.json({ ok: true, announcement: next });
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;

    const prev = getAnnouncement(id);
    if (!prev) {
      throw errors.notFound('指定したお知らせが見つかりません');
    }

    const ok = deleteAnnouncement(id);
    if (!ok) {
      throw errors.notFound('お知らせの削除に失敗しました');
    }

    await logAudit({
      userId: session.user.id,
      action: 'announcement.delete',
      resource: `announcement:${id}`,
      metadata: { title: prev.title, audience: prev.audience },
    });

    return NextResponse.json({ ok: true });
  },
);
