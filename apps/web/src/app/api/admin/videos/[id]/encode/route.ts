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
import { createHlsJob, mediaConvertDiagnostics } from '@/lib/mediaconvert';

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

    const diag = mediaConvertDiagnostics();
    if (!diag.ready) {
      throw errors.badRequest(
        `MediaConvert が未設定です (${diag.missingRequired.join(' / ')})。環境変数をご確認ください。`,
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
      metadata: {
        jobId,
        s3SourceKey: video.s3SourceKey,
        outputBucket: diag.resolved.outputBucket,
        qualities: diag.resolved.qualities.join(','),
      },
    });

    return NextResponse.json({
      ok: true,
      jobId,
      status: updated.status,
      outputBucket: diag.resolved.outputBucket,
      qualities: diag.resolved.qualities,
      // 再生設定 (CloudFront 署名) が未完了ならクライアントに警告を返す
      warnings: [
        ...(diag.missingPlayback.length > 0
          ? [
              `再生に必要な設定が未完了です: ${diag.missingPlayback.join(' / ')}`,
            ]
          : []),
        ...(diag.missingAutomation.length > 0
          ? [
              `エンコード完了の自動反映に必要な設定が未完了です: ${diag.missingAutomation.join(' / ')}（完了後に「手動で公開」を押してください）`,
            ]
          : []),
      ],
    });
  },
);
