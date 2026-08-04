/**
 * POST /api/admin/videos/job-complete
 *   MediaConvert ジョブ完了通知の受け口 (EventBridge → Lambda から呼ばれる)。
 *
 * ## 認証
 *   - x-cron-secret ヘッダが CRON_SECRET と一致すること (Lambda が保持)。
 *     もしくは CONTENT 権限を持つ管理者セッション (手動リトライ用)。
 *
 * ## body
 *   { jobId: string, status: 'COMPLETE' | 'ERROR', videoId?: string,
 *     durationSeconds?: number, errorMessage?: string }
 *
 * ## 挙動
 *   - status=COMPLETE : 対象 Video を READY 化。s3HlsKey を確定し publishedAt を設定。
 *   - status=ERROR    : 対象 Video を FAILED 化。
 *   - videoId が無い場合は mediaConvertJob=jobId で逆引きする。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { z } from 'zod';
import { auth } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { env } from '@/lib/env';
import { logAudit } from '@/lib/audit';
import { hlsMasterKey, thumbnailKey } from '@/lib/mediaconvert';

export const runtime = 'nodejs';

const BodySchema = z.object({
  jobId: z.string().min(1),
  status: z.enum(['COMPLETE', 'ERROR']),
  videoId: z.string().optional(),
  durationSeconds: z.number().int().min(0).optional(),
  errorMessage: z.string().max(1000).optional(),
});

export const POST = handle(async (req: Request) => {
  // --- 認証: cron secret もしくは CONTENT 管理者 ---
  const cronSecret = req.headers.get('x-cron-secret');
  const validCron = cronSecret && env.cron?.secret && cronSecret === env.cron.secret;
  if (!validCron) {
    const session = await auth();
    const role = session?.user?.role;
    if (role !== 'SUPER_ADMIN' && role !== 'STAFF') {
      throw errors.forbidden('Cron secret もしくは管理者権限が必要です');
    }
  }

  const body = BodySchema.parse(await req.json());

  // 対象動画の特定 (videoId 優先、無ければ jobId で逆引き)
  const video = body.videoId
    ? await prisma.video.findUnique({ where: { id: body.videoId } })
    : await prisma.video.findFirst({ where: { mediaConvertJob: body.jobId } });

  if (!video) throw errors.notFound('対象の動画が見つかりません');

  if (body.status === 'ERROR') {
    await prisma.video.update({ where: { id: video.id }, data: { status: 'FAILED' } });
    await logAudit({
      action: 'admin.video.encode_failed',
      resource: `video:${video.id}`,
      metadata: { jobId: body.jobId, errorMessage: body.errorMessage ?? null },
    });
    return NextResponse.json({ ok: true, status: 'FAILED' });
  }

  // COMPLETE: HLS マスタープレイリストのキーを確定して READY 化
  const s3HlsKey = hlsMasterKey(video.id);
  // MediaConvert の FRAME_CAPTURE 出力 (サムネイル) の S3 キー。
  // 非公開バケット上のキーをそのまま保存し、表示時に CloudFront 署名する
  // (lib/cdn-signer.ts の resolveThumbnailUrl)。
  // 既に管理者が手動でサムネイルを設定している場合は上書きしない。
  const s3ThumbnailKey = thumbnailKey(video.id);

  const updated = await prisma.video.update({
    where: { id: video.id },
    data: {
      status: 'READY',
      s3HlsKey,
      ...(video.thumbnailUrl ? {} : { thumbnailUrl: s3ThumbnailKey }),
      ...(body.durationSeconds !== undefined
        ? { durationSeconds: body.durationSeconds }
        : {}),
      // 既に公開日時があれば維持、無ければ現在時刻
      publishedAt: video.publishedAt ?? new Date(),
    },
  });

  await logAudit({
    action: 'admin.video.encode_completed',
    resource: `video:${video.id}`,
    metadata: { jobId: body.jobId, s3HlsKey, thumbnailUrl: updated.thumbnailUrl },
  });

  return NextResponse.json({ ok: true, status: updated.status, s3HlsKey });
});
