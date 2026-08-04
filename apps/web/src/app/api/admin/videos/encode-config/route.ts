/**
 * GET /api/admin/videos/encode-config
 *
 * エンコード (MediaConvert) / 配信 (CloudFront) の設定状況を返す診断エンドポイント。
 * 管理画面の「動画アップロード」「動画詳細」で、何がどこまで設定できているかを
 * 具体的な環境変数名つきで表示するために使う。
 *
 * 秘密情報 (CLOUDFRONT_PRIVATE_KEY 等) の値そのものは絶対に返さず、
 * 「設定済み / 未設定」の真偽と、非機密な解決結果 (バケット名 / プレフィックス) のみ返す。
 */
import { NextResponse } from 'next/server';
import { requireCapability } from '@/auth';
import { handle } from '@/lib/errors';
import { mediaConvertDiagnostics } from '@/lib/mediaconvert';
import { isVideoCdnConfigured } from '@/lib/cdn-signer';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireCapability('CONTENT');
  const diag = mediaConvertDiagnostics();

  return NextResponse.json({
    // エンコードを実行できるか
    encodeReady: diag.ready,
    // 署名付き URL で再生できるか
    playbackReady: isVideoCdnConfigured(),
    // 完了時に自動で READY 化できるか (Lambda → job-complete の cron secret)
    automationReady: diag.missingAutomation.length === 0,
    missing: {
      required: diag.missingRequired,
      playback: diag.missingPlayback,
      automation: diag.missingAutomation,
    },
    resolved: diag.resolved,
  });
});
