import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { MAX_VIDEO_QUALITY, allowedVideoQualities, VIDEO_SIGNED_URL_TTL_SEC } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { currentDeliveryMode } from '@/lib/video-delivery';
import { requirePlayableVideo } from '@/lib/video-access';
import { hlsProxyUrl } from '@/lib/hls-proxy-url';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { video, userId, plan, userAgent } = await requirePlayableVideo(req, id);

  // 配信経路を決定する。
  //
  // 以前はここで CloudFront 署名鍵 (CLOUDFRONT_KEY_PAIR_ID /
  // CLOUDFRONT_PRIVATE_KEY) が無いと即エラーにしていた。しかしこの 2 つは
  // CDK で自動作成されず手動登録が前提のため、既定では必ず未設定になり
  // 「エンコードは成功したのに再生できない」状態になっていた。
  //
  // 現在は HLS 出力バケットが分かれば S3 プリサインド URL で配信できる
  // (EC2 ロールに出力バケットの読み取り権限がある)。両方無い場合のみ
  // エラーにする。エンドユーザーには設定変数名を見せない。
  const mode = currentDeliveryMode();
  if (mode === 'none') {
    throw errors.internal('動画の配信先が設定されていません。管理者にお問い合わせください。');
  }

  // CloudFront の署名付き URL を直接返すのではなく、プレイリストプロキシを返す。
  //
  // 理由: CloudFront 署名は「その URL 1 本」にしか効かないため、
  // プレイリスト内の相対 URI (variant playlist / .ts セグメント) は
  // 署名なしでリクエストされ 403 になる。プロキシがプレイリストを
  // 書き換えて署名クエリを埋め込むことで、hls.js でも
  // iOS Safari のネイティブ HLS でもセグメントまで再生できる。
  const hlsUrl = hlsProxyUrl(video.id, video.s3HlsKey);
  const expiresAt = new Date(Date.now() + VIDEO_SIGNED_URL_TTL_SEC * 1000);

  const maxQuality = MAX_VIDEO_QUALITY[plan];
  const allowedQualities = allowedVideoQualities(plan);

  prisma.videoViewLog
    .create({
      data: {
        videoId: video.id,
        userId,
        userAgent,
      },
    })
    .catch(() => {});

  // クライアントは maxQuality に基づき HLS マスタープレイリストから該当 variant のみを選択
  return NextResponse.json({
    hlsUrl,
    expiresAt: expiresAt.toISOString(),
    plan,
    maxQuality,
    allowedQualities,
  });
});
