import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { MAX_VIDEO_QUALITY, allowedVideoQualities, VIDEO_SIGNED_URL_TTL_SEC } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { isVideoCdnConfigured } from '@/lib/cdn-signer';
import { requirePlayableVideo } from '@/lib/video-access';
import { hlsProxyUrl } from '@/lib/hls-proxy-url';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { video, userId, plan, userAgent } = await requirePlayableVideo(req, id);

  if (!isVideoCdnConfigured()) {
    // CloudFront 署名設定 (ドメイン / キーペア / 秘密鍵) が未完了。
    // このまま URL を返しても CloudFront が 403 を返すため、明確に原因を伝える。
    throw errors.badRequest(
      '動画配信 (CloudFront 署名付き URL) が未設定です。CLOUDFRONT_VIDEO_DOMAIN / CLOUDFRONT_KEY_PAIR_ID / CLOUDFRONT_PRIVATE_KEY を設定してください。',
    );
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
