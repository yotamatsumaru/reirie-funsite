/**
 * PATCH/DELETE /api/super-admin/announcements/[id]
 *   - SUPER_ADMIN 限定: お知らせの更新 / 削除
 *
 * PATCH body: { title?, body?, audience?, status?, sendEmail? }
 * DELETE: no body
 *
 * DRAFT → PUBLISHED への変更時に sendEmail=true (更新後の値) であれば
 * 一斉メール送信をバックグラウンドでキックする。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendAnnouncementEmails, shouldTriggerEmail } from '@/lib/bulk-email';

export const runtime = 'nodejs';

const PatchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().min(1).max(4000).optional(),
    audience: z.enum(['ALL', 'MEMBERS', 'PREMIUM']).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
    sendEmail: z.boolean().optional(),
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

    const prev = await prisma.announcement.findUnique({ where: { id } });
    if (!prev) {
      throw errors.notFound('指定したお知らせが見つかりません');
    }

    const nextPublishedAt =
      prev.status === 'DRAFT' && parsed.data.status === 'PUBLISHED' && !prev.publishedAt
        ? new Date()
        : undefined;

    // sendEmail を新たに true にした、または元々 true でメール未送信のまま
    // 公開に変更する場合は emailStatus を PENDING に戻す (再送のトリガー判定は
    // shouldTriggerEmail に委ねる)。
    const nextSendEmail = parsed.data.sendEmail ?? prev.sendEmail;
    const nextStatus = parsed.data.status ?? prev.status;
    const willNeedEmailQueue =
      nextSendEmail &&
      nextStatus === 'PUBLISHED' &&
      (prev.emailStatus === 'NOT_REQUESTED' || parsed.data.sendEmail === true);

    const updated = await prisma.announcement.update({
      where: { id },
      data: {
        ...parsed.data,
        publishedAt: nextPublishedAt,
        ...(willNeedEmailQueue ? { emailStatus: 'PENDING' } : {}),
      },
    });

    await logAudit({
      userId: session.user.id,
      action: 'announcement.update',
      resource: `announcement:${id}`,
      metadata: {
        changed: parsed.data,
        prevStatus: prev.status,
      },
    });

    if (shouldTriggerEmail(updated)) {
      void sendAnnouncementEmails(updated.id);
    }

    return NextResponse.json({ ok: true, announcement: updated });
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;

    const prev = await prisma.announcement.findUnique({ where: { id } });
    if (!prev) {
      throw errors.notFound('指定したお知らせが見つかりません');
    }

    await prisma.announcement.delete({ where: { id } });

    await logAudit({
      userId: session.user.id,
      action: 'announcement.delete',
      resource: `announcement:${id}`,
      metadata: { title: prev.title, audience: prev.audience },
    });

    return NextResponse.json({ ok: true });
  },
);
