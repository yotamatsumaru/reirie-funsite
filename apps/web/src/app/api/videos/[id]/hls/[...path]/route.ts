/**
 * HLS プレイリスト プロキシ
 *
 * `GET /api/videos/<videoId>/hls/index.m3u8`
 * `GET /api/videos/<videoId>/hls/index_720p.m3u8`
 *
 * ## なぜプロキシするのか (`.ts` セグメント 403 の恒久対策)
 *
 * CloudFront の署名付き URL は「その URL 1 本」に対する許可でしかない。
 * HLS はプレイリストとセグメントを別リクエストで取得するため、
 * プレイリスト内の相対 URI (`index_720p_00001.ts`) はクエリを引き継がず
 * 署名なしでリクエストされ、CloudFront が 403 を返す。
 *
 * そこで:
 *  - 署名を **ワイルドカードのカスタムポリシー** (`hls/<videoId>/*`) にする
 *  - プレイリストをこのルートで取得し、中の相対 URI に署名クエリを埋め込む
 *
 * これにより hls.js だけでなく、JS で介入できない
 * iOS Safari のネイティブ HLS でも再生できる。
 *
 * セグメント (`.ts`) 自体はプロキシせず CloudFront から直接配信する
 * (帯域を Next.js サーバに通さないため)。プレイリストだけが軽量に通る。
 */
import { NextResponse } from 'next/server';
import { handle, errors } from '@/lib/errors';
import { requirePlayableVideo } from '@/lib/video-access';
import { signVideoUrl, hlsDirPrefix, isVideoCdnConfigured } from '@/lib/cdn-signer';
import { extractSignatureQuery, rewritePlaylist, isPlaylistUri } from '@/lib/hls-rewrite';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
/** 署名クエリを含むためキャッシュ不可 */
export const dynamic = 'force-dynamic';

/** プレイリスト取得のタイムアウト (ms) */
const FETCH_TIMEOUT_MS = 8000;

export const GET = handle(
  async (req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }) => {
    const { id, path } = await ctx.params;
    const rel = (path ?? []).join('/');

    // プレイリスト以外 (.ts 等) はプロキシしない。
    // セグメントは署名クエリ付きで CloudFront から直接取得される想定。
    if (!rel || !isPlaylistUri(rel)) {
      throw errors.badRequest('プレイリスト (.m3u8) のみ取得できます');
    }
    // ディレクトリトラバーサル防止
    if (rel.includes('..') || rel.startsWith('/')) {
      throw errors.badRequest('不正なパスです');
    }

    const { video } = await requirePlayableVideo(req, id);

    if (!isVideoCdnConfigured()) {
      throw errors.badRequest(
        '動画配信 (CloudFront 署名付き URL) が未設定です。CLOUDFRONT_VIDEO_DOMAIN / CLOUDFRONT_KEY_PAIR_ID / CLOUDFRONT_PRIVATE_KEY を設定してください。',
      );
    }

    // 要求されたプレイリストは、この動画の HLS ディレクトリ配下に限定する
    const dir = hlsDirPrefix(video.s3HlsKey);
    const targetKey = `${dir}${rel}`;

    // ワイルドカード署名 (hls/<videoId>/*) を取得
    const { url: signedUrl, expiresAt } = signVideoUrl(targetKey);
    const signatureQuery = extractSignatureQuery(signedUrl);

    const upstream = await fetchWithTimeout(signedUrl);
    if (!upstream.ok) {
      if (upstream.status === 403 || upstream.status === 404) {
        throw errors.notFound('プレイリストが見つかりません');
      }
      throw errors.internal(`プレイリストを取得できませんでした (${upstream.status})`);
    }

    const body = await upstream.text();
    const segmentBase = `https://${env.cloudfront.videoDomain}/${dir}`;

    const rewritten = rewritePlaylist(body, {
      segmentBase,
      signatureQuery,
      // ネストされた variant playlist は相対パスのまま残す。
      // このルート自身が `/api/videos/<id>/hls/index.m3u8` で配信されるため、
      // 相対解決すると再びこのプロキシに入り、再帰的に書き換えられる。
      playlistUrl: (relativePath) => relativePath,
    });

    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'private, no-store',
        // 署名の有効期限をクライアントに伝える (再取得判断用)
        'X-Signature-Expires-At': expiresAt.toISOString(),
      },
    });
  },
);

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, cache: 'no-store' });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw errors.internal('プレイリスト取得がタイムアウトしました');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
