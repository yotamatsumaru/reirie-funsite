/**
 * GET  /api/admin/videos - 動画一覧 (全ステータス)
 * POST /api/admin/videos - 動画レコード作成
 *   - クライアントは upload-url で取得した s3SourceKey を渡す
 *   - status=UPLOADING で作成し、MediaConvert ジョブ開始は別フロー
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { CreateVideoSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  await requireCapability('CONTENT');
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 30)));
  const status = url.searchParams.get('status');

  const where = status
    ? { status: status as 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED' }
    : {};

  const [items, total] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.video.count({ where }),
  ]);

  return NextResponse.json({ items, page, limit, total });
});

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('CONTENT');
  const body = CreateVideoSchema.parse(await req.json());

  const created = await prisma.video.create({
    data: {
      title: body.title,
      description: body.description,
      s3SourceKey: body.s3SourceKey,
      accessLevel: body.accessLevel,
      status: 'UPLOADING',
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.video.created',
    resource: `video:${created.id}`,
    metadata: { s3SourceKey: created.s3SourceKey },
  });

  return NextResponse.json(created, { status: 201 });
});
