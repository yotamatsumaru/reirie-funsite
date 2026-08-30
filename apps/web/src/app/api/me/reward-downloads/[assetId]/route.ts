/**
 * GET /api/me/reward-downloads/[assetId]
 *  - デジタル特典ファイルを本人確認のうえダウンロード配信する。
 *  - アクセス条件: そのファイルが属する景品を、ログイン会員が交換済み
 *    (RewardRedemption が CANCELED 以外) であること。
 *  - 保存方式に応じて配信:
 *      S3 (url あり)     : 署名なしの公開/CDN URL へ 302 リダイレクト
 *      DB 保存 (data あり): バイト列を Content-Disposition: attachment で配信
 *
 * 【再ダウンロードは回数無制限 (意図的な仕様)】
 * 交換は 1 会員 1 回に制限している (重複で Pui を取らないため) が、
 * ダウンロードには上限を設けない。機種変更・PC 買い換え・ファイル紛失で
 * 再取得できないと、交換 1 回制限と組み合わさって会員が詰む。
 * RewardDownloadLog は集計専用で、制限の判定には使わないことに注意。
 */
import { prisma } from '@idol/db';
import { canRedownloadDigitalAsset } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await ctx.params;

  let session: Awaited<ReturnType<typeof requireApiSession>>;
  try {
    session = await requireApiSession(req);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const asset = await prisma.rewardDigitalAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      catalogItemId: true,
      fileName: true,
      contentType: true,
      url: true,
      data: true,
    },
  });
  if (!asset) return new Response('Not Found', { status: 404 });

  // 本人がこの景品を交換済みか (キャンセル以外) を照合
  const redeemed = await prisma.rewardRedemption.findFirst({
    where: {
      userId: session.user.id,
      catalogItemId: asset.catalogItemId,
      itemKind: 'DIGITAL',
      status: { not: 'CANCELED' },
    },
    select: { id: true },
  });
  // 交換済みであれば何度でも OK。判定ロジックは shared に一本化してある。
  if (!canRedownloadDigitalAsset(redeemed !== null)) {
    return new Response('Forbidden', { status: 403 });
  }

  // ダウンロード数集計用のログを記録 (景品単位)。
  // 配信をブロックしないよう best-effort (失敗しても無視) とする。
  try {
    await prisma.rewardDownloadLog.create({
      data: { catalogItemId: asset.catalogItemId, userId: session.user.id },
    });
  } catch (e) {
    console.error('[reward-downloads] failed to log download', e);
  }

  const dispositionName = encodeURIComponent(asset.fileName || `download-${asset.id}`);

  // S3 / CDN 保存: URL へリダイレクト
  if (asset.url) {
    return Response.redirect(asset.url, 302);
  }

  // DB 保存: バイト列を添付として配信
  if (asset.data) {
    const body = Buffer.isBuffer(asset.data) ? asset.data : Buffer.from(asset.data);
    return new Response(body as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': asset.contentType || 'application/octet-stream',
        'Content-Length': String(body.byteLength),
        'Content-Disposition': `attachment; filename*=UTF-8''${dispositionName}`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  return new Response('Not Found', { status: 404 });
}
