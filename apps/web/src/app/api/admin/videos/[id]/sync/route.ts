/**
 * POST /api/admin/videos/[id]/sync
 *   エンコード状態を MediaConvert / S3 に直接問い合わせて DB に反映する。
 *
 * ## なぜ必要か
 * MediaConvert は完了を push 通知しない。通常は
 *   EventBridge → Lambda → POST /api/admin/videos/job-complete
 * で READY 化されるが、この通知経路が未整備だと Video は
 * **PROCESSING のまま永久に止まる**。さらに「手動で公開」は
 * `s3HlsKey` の存在が条件だったため、
 *   完了通知が来ない → s3HlsKey が空 → 手動公開できない
 * というデッドロックになっていた。
 *
 * このエンドポイントは Lambda に依存せず、
 *   1. MediaConvert の GetJob でジョブ状態を直接照会
 *   2. (ジョブが引けなければ) 出力バケットの index.m3u8 の実在を確認
 * という 2 系統の根拠から状態を確定させる復旧経路である。
 *
 * ## 認証
 *   CONTENT 権限を持つ管理者。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  getJobState,
  hlsMasterKey,
  thumbnailKey,
  outputBucket,
  mediaConvertDiagnostics,
  type MediaConvertJobState,
} from '@/lib/mediaconvert';
import { objectExists } from '@/lib/s3';
import { decideReconcile, describeReconcile } from '@/lib/video-sync';

export const runtime = 'nodejs';

export const POST = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('CONTENT');
    const { id } = await ctx.params;

    const video = await prisma.video.findUnique({ where: { id } });
    if (!video) throw errors.notFound('動画が見つかりません');

    const diag = mediaConvertDiagnostics();
    if (!diag.ready) {
      throw errors.badRequest(
        `MediaConvert が未設定のため状態を確認できません (${diag.missingRequired.join(' / ')})`,
      );
    }

    const hlsKey = hlsMasterKey(video.id);

    // --- 1) ジョブ状態の直接照会 ---
    // ジョブ ID が無い / 保持期限切れ / 権限不足でも落とさず、
    // S3 実体の確認 (2) にフォールバックさせる。
    let jobState: MediaConvertJobState | null = null;
    let jobLookupError: string | null = null;
    if (video.mediaConvertJob) {
      try {
        jobState = await getJobState(video.mediaConvertJob);
      } catch (e) {
        jobLookupError = (e as Error).message;
      }
    }

    // --- 2) ジョブから確定できないときだけ S3 の実体を見る ---
    // (GetJob で COMPLETE/ERROR/進行中が分かっているなら HeadObject は不要)
    const needsS3Check =
      !jobState ||
      jobState.status === 'UNKNOWN' ||
      (jobState.status !== 'COMPLETE' &&
        jobState.status !== 'ERROR' &&
        jobState.status !== 'CANCELED' &&
        jobState.status !== 'PROGRESSING' &&
        jobState.status !== 'SUBMITTED');

    let hlsExists: boolean | undefined;
    let s3CheckError: string | null = null;
    if (needsS3Check) {
      try {
        hlsExists = await objectExists(outputBucket(), hlsKey);
      } catch (e) {
        s3CheckError = (e as Error).message;
      }
    }

    const decision = decideReconcile({
      currentStatus: video.status,
      jobState,
      ...(hlsExists !== undefined ? { hlsExists } : {}),
      hlsKey,
    });

    // --- 3) 判定を DB に反映 ---
    if (decision.action === 'ready') {
      const updated = await prisma.video.update({
        where: { id },
        data: {
          status: 'READY',
          s3HlsKey: decision.s3HlsKey,
          // 管理者が手動でサムネイルを設定済みなら上書きしない
          ...(video.thumbnailUrl ? {} : { thumbnailUrl: thumbnailKey(video.id) }),
          ...(decision.durationSeconds !== undefined
            ? { durationSeconds: decision.durationSeconds }
            : {}),
          publishedAt: video.publishedAt ?? new Date(),
        },
      });
      await logAudit({
        userId: session.user.id,
        action: 'admin.video.sync_ready',
        resource: `video:${id}`,
        metadata: {
          reason: decision.reason,
          jobId: video.mediaConvertJob ?? null,
          s3HlsKey: decision.s3HlsKey,
        },
      });
      return NextResponse.json({
        ok: true,
        changed: true,
        status: updated.status,
        s3HlsKey: updated.s3HlsKey,
        message: describeReconcile(decision),
      });
    }

    if (decision.action === 'failed') {
      const updated = await prisma.video.update({
        where: { id },
        data: { status: 'FAILED' },
      });
      await logAudit({
        userId: session.user.id,
        action: 'admin.video.sync_failed',
        resource: `video:${id}`,
        metadata: {
          reason: decision.reason,
          jobId: video.mediaConvertJob ?? null,
          errorMessage: decision.errorMessage ?? null,
        },
      });
      return NextResponse.json({
        ok: true,
        changed: true,
        status: updated.status,
        message: describeReconcile(decision),
      });
    }

    // 進行中 / 判定不能 — DB は変更しない
    return NextResponse.json({
      ok: true,
      changed: false,
      status: video.status,
      ...(decision.action === 'processing' && decision.progressPercent !== undefined
        ? { progressPercent: decision.progressPercent }
        : {}),
      message: describeReconcile(decision),
      // 何が確認できなかったのかを管理者に伝える (原因切り分け用)
      ...(jobLookupError ? { jobLookupError } : {}),
      ...(s3CheckError ? { s3CheckError } : {}),
    });
  },
);
