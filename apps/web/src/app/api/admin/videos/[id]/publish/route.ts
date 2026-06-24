/**
 * POST /api/admin/videos/[id]/publish
 *  - 動画を READY 化 + 公開 (publishedAt セット)
 *  - 通常は MediaConvert 完了通知 (Lambda) で自動的に READY になるが、
 *    管理画面からの手動公開フラグ用としても提供
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { z } from 'zod';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const PublishBodySchema = z.object({
  s3HlsKey: z.string().min(1).optional(),
  durationSeconds: z.number().int().min(0).optional(),
  publishedAt: z.iso.datetime().optional(),
});

export const POST = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('CONTENT');
    const { id } = await ctx.params;
    const body = PublishBodySchema.parse(
      await req.json().catch(() => ({})),
    );

    const exists = await prisma.video.findUnique({ where: { id } });
    if (!exists) throw errors.notFound('動画が見つかりません');

    if (!body.s3HlsKey && !exists.s3HlsKey) {
      throw errors.badRequest('s3HlsKey が必要です (MediaConvert 完了前は公開できません)');
    }

    const updated = await prisma.video.update({
      where: { id },
      data: {
        status: 'READY',
        ...(body.s3HlsKey ? { s3HlsKey: body.s3HlsKey } : {}),
        ...(body.durationSeconds !== undefined
          ? { durationSeconds: body.durationSeconds }
          : {}),
        publishedAt: body.publishedAt ? new Date(body.publishedAt) : new Date(),
      },
    });

    await logAudit({
      userId: session.user.id,
      action: 'admin.video.published',
      resource: `video:${id}`,
    });

    return NextResponse.json(updated);
  },
);
