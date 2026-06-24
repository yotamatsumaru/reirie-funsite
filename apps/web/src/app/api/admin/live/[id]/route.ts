/**
 * GET    /api/admin/live/[id] - 詳細
 * PATCH  /api/admin/live/[id] - 更新 (status 遷移含む: SCHEDULED→LIVE→ENDED)
 * DELETE /api/admin/live/[id] - 削除
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { UpdateLiveStreamSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    await requireCapability('CONTENT');
    const { id } = await ctx.params;
    const live = await prisma.liveStream.findUnique({ where: { id } });
    if (!live) throw errors.notFound('ライブ配信が見つかりません');
    return NextResponse.json(live);
  },
);

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('CONTENT');
    const { id } = await ctx.params;
    const body = UpdateLiveStreamSchema.parse(await req.json());

    const exists = await prisma.liveStream.findUnique({ where: { id } });
    if (!exists) throw errors.notFound('ライブ配信が見つかりません');

    // ステータス遷移時の自動タイムスタンプ
    let startedAt = exists.startedAt;
    let endedAt = exists.endedAt;
    if (body.status === 'LIVE' && !exists.startedAt) startedAt = new Date();
    if (body.status === 'ENDED' && !exists.endedAt) endedAt = new Date();

    const updated = await prisma.liveStream.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.thumbnailUrl !== undefined ? { thumbnailUrl: body.thumbnailUrl } : {}),
        ...(body.isPrivate !== undefined ? { isPrivate: body.isPrivate } : {}),
        ...(body.accessLevel ? { accessLevel: body.accessLevel } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.scheduledStartAt
          ? { scheduledStartAt: new Date(body.scheduledStartAt) }
          : {}),
        ...(body.ivsChannelArn ? { ivsChannelArn: body.ivsChannelArn } : {}),
        ...(body.ivsPlaybackUrl ? { ivsPlaybackUrl: body.ivsPlaybackUrl } : {}),
        startedAt,
        endedAt,
      },
    });

    await logAudit({
      userId: session.user.id,
      action: 'admin.live.updated',
      resource: `live:${id}`,
      metadata: { changes: Object.keys(body) },
    });

    return NextResponse.json(updated);
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('CONTENT');
    const { id } = await ctx.params;
    const exists = await prisma.liveStream.findUnique({ where: { id } });
    if (!exists) throw errors.notFound('ライブ配信が見つかりません');
    await prisma.liveStream.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: 'admin.live.deleted',
      resource: `live:${id}`,
    });
    return NextResponse.json({ deleted: true });
  },
);
