/**
 * POST /api/admin/videos/[id]/encode
 *   - source 動画を MediaConvert で HLS (TS) にエンコードするジョブを開始する。
 *   - status を PROCESSING に更新し、mediaConvertJob にジョブ ID を保存する。
 *   - 完了は EventBridge → Lambda → /api/admin/videos/job-complete で READY 化。
 *     (Lambda 未整備でも管理画面の「公開」で手動 READY 化が可能)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { createHlsJob, isMediaConvertConfigured } from '@/lib/mediaconvert';

export const runtime = 'nodejs';

export const POST = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('CONTENT');
    const { id } = await ctx.params;

    const video = await prisma.video.findUnique({ where: { id } });
    if (!video) throw errors.notFound('動画が見つかりません');
    if (!video.s3SourceKey) {
      throw errors.badRequest('ソース動画がアップロードされていません');
    }
    if (video.status === 'PROCESSING') {
      throw errors.badRequest('すでにエンコード中です');
    }
    if (!isMediaConvertConfigured()) {
      throw errors.badRequest(
        'MediaConvert が未設定です (S3_VIDEO_BUCKET / MEDIACONVERT_ROLE_ARN)。環境変数をご確認ください。',
      );
    }

    let jobId: string;
    try {
      jobId = await createHlsJob({ videoId: video.id, s3SourceKey: video.s3SourceKey });
    } catch (e) {
      throw errors.badRequest(`エンコードジョブの作成に失敗しました: ${(e as Error).message}`);
    }

    const updated = await prisma.video.update({
      where: { id },
      data: { status: 'PROCESSING', mediaConvertJob: jobId },
    });

    await logAudit({
      userId: session.user.id,
      action: 'admin.video.encode_started',
      resource: `video:${id}`,
      metadata: { jobId, s3SourceKey: video.s3SourceKey },
    });

    return NextResponse.json({ ok: true, jobId, status: updated.status });
  },
);
