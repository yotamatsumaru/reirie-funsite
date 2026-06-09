/**
 * GET  /api/admin/live - ライブ配信一覧 (全ステータス)
 * POST /api/admin/live - ライブ配信レコード作成
 *   ※ IVS チャネル自体は事前に CDK / コンソールで作成しておき、
 *     その ARN と playbackUrl をここに登録する想定 (簡易MVP)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { z } from 'zod';
import { CreateLiveStreamSchema } from '@idol/shared';
import { requireAdmin } from '@/auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const CreateLiveAdminSchema = CreateLiveStreamSchema.extend({
  ivsChannelArn: z.string().min(1),
  ivsPlaybackUrl: z.url(),
});

export const GET = handle(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const where = status
    ? { status: status as 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELED' }
    : {};
  const items = await prisma.liveStream.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ items });
});

export const POST = handle(async (req: Request) => {
  const session = await requireAdmin();
  const body = CreateLiveAdminSchema.parse(await req.json());

  const created = await prisma.liveStream.create({
    data: {
      title: body.title,
      description: body.description,
      thumbnailUrl: body.thumbnailUrl,
      ivsChannelArn: body.ivsChannelArn,
      ivsPlaybackUrl: body.ivsPlaybackUrl,
      isPrivate: body.isPrivate,
      accessLevel: body.accessLevel,
      status: 'SCHEDULED',
      scheduledStartAt: body.scheduledStartAt ? new Date(body.scheduledStartAt) : null,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.live.created',
    resource: `live:${created.id}`,
    metadata: { ivsChannelArn: body.ivsChannelArn },
  });

  return NextResponse.json(created, { status: 201 });
});
