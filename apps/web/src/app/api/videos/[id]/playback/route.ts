import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { MAX_VIDEO_QUALITY, allowedVideoQualities, VIDEO_SIGNED_URL_TTL_SEC } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { currentDeliveryMode } from '@/lib/video-delivery';
import { requirePlayableVideo } from '@/lib/video-access';
import { hlsProxyUrl } from '@/lib/hls-proxy-url';

export const runtime = 'nodejs';

/**
 * 同じ会員の直近の視聴位置を返す（続きから再生用）。
 *
 * この関数は新しい視聴ログを作る**前**に呼ぶ。作成後に呼ぶと
 * 「今作った position 0 の行」も候補に入り、条件の順序に
 * 依存した読みにくいコードになるため。
 *
 * 完視聴済み（completed）の行は無視する。最後まで見た動画を開き直したとき、
 * 終わり際から再生が始まると「もう一度見たい」意図に反するため。
 *
 * 計測が失敗しても再生は妨げないので、例外は 0 に丸める。
 */
async function resumePosition(videoId: string, userId: string): Promise<number> {
  try {
    const prev = await prisma.videoViewLog.findFirst({
      where: { videoId, userId, completed: false, lastPositionMs: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      select: { lastPositionMs: true },
    });
    return prev?.lastPositionMs ?? 0;
  } catch {
    return 0;
  }
}

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

  // 続きの位置は視聴ログを作る前に読む（上のコメント参照）。
  const resumePositionMs = await resumePosition(video.id, userId);

  // 視聴ログを作り、その ID をクライアントへ返す。
  //
  // 以前は作成を fire-and-forget していたが、ID を返す必要が出たため
  // await する。進捗計測 (PATCH /api/videos/[id]/progress) は
  // この ID の行を更新していく方式で、行を増やさないことで
  // 「行数 = 視聴回数」という既存の意味を保っている。
  //
  // `lastActiveAt` はここでは入れない。これは「進捗を 1 度でも
  // 受け取れた視聴」の印として集計側が使っており、再生開始時点で
  // 埋めてしまうと、すぐ閉じて 1 度も進捗が来なかった視聴まで
  // 「視聴時間 0 秒で計測済み」として平均の分母に入り、
  // 平均視聴時間・完視聴率が実態より低く出てしまう。
  //
  // ログ作成が失敗しても再生自体は続行させる。計測は付加的な機能であり、
  // ここで例外を投げると「集計が取れない」ではなく「動画が見られない」に
  // 悪化するため。その場合 viewLogId は null になり、
  // クライアントは進捗送信を行わない。
  let viewLogId: string | null = null;
  try {
    const log = await prisma.videoViewLog.create({
      data: { videoId: video.id, userId, userAgent },
      select: { id: true },
    });
    viewLogId = log.id;
  } catch {
    viewLogId = null;
  }

  // クライアントは maxQuality に基づき HLS マスタープレイリストから該当 variant のみを選択
  return NextResponse.json({
    hlsUrl,
    expiresAt: expiresAt.toISOString(),
    plan,
    maxQuality,
    allowedQualities,
    /** 進捗送信に使う視聴ログ ID。計測不能時は null。 */
    viewLogId,
    /** 続きから再生するための前回位置 (ミリ秒)。0 なら先頭から。 */
    resumePositionMs,
  });
});
