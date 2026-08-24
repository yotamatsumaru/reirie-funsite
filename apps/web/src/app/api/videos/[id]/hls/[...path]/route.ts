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
import { signVideoUrl, hlsDirPrefix } from '@/lib/cdn-signer';
import {
  extractSignatureQuery,
  rewritePlaylist,
  isPlaylistUri,
  collectPlaylistUris,
} from '@/lib/hls-rewrite';
import {
  currentDeliveryMode,
  presignS3Get,
  presignPlaylistUris,
} from '@/lib/video-delivery';
import { env } from '@/lib/env';
import { VIDEO_SIGNED_URL_TTL_SEC } from '@idol/shared';

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

    // 配信経路を決定する。CloudFront 署名鍵が無くても、HLS 出力バケットが
    // 分かっていれば S3 プリサインド URL で配信できる (video-delivery.ts)。
    const mode = currentDeliveryMode();
    if (mode === 'none') {
      throw errors.internal(
        '動画の配信先が設定されていません。管理者にお問い合わせください。',
      );
    }

    // 要求されたプレイリストは、この動画の HLS ディレクトリ配下に限定する
    const dir = hlsDirPrefix(video.s3HlsKey);
    const targetKey = `${dir}${rel}`;

    // プレイリスト自体の取得URL
    //   CloudFront: ワイルドカード署名 (hls/<videoId>/*)
    //   S3        : オブジェクト単体のプリサインド
    const upstreamUrl =
      mode === 'cloudfront' ? signVideoUrl(targetKey).url : await presignS3Get(targetKey);
    const expiresAt = new Date(Date.now() + VIDEO_SIGNED_URL_TTL_SEC * 1000);

    const upstream = await fetchWithTimeout(upstreamUrl);
    if (!upstream.ok) {
      if (upstream.status === 403 || upstream.status === 404) {
        throw errors.notFound('プレイリストが見つかりません');
      }
      throw errors.internal(`プレイリストを取得できませんでした (${upstream.status})`);
    }

    const body = await upstream.text();

    // ネストされた variant playlist は相対パスのまま残す。
    // このルート自身が `/api/videos/<id>/hls/index.m3u8` で配信されるため、
    // 相対解決すると再びこのプロキシに入り、そこで再署名される。
    const playlistUrl = (relativePath: string) => relativePath;

    let rewritten: string;
    if (mode === 'cloudfront') {
      const signatureQuery = extractSignatureQuery(upstreamUrl);
      rewritten = rewritePlaylist(body, {
        segmentBase: `https://${env.cloudfront.videoDomain}/${dir}`,
        signatureQuery,
        playlistUrl,
      });
    } else {
      // S3 はワイルドカード署名ができないため、セグメントを 1 本ずつ署名する。
      // 署名はローカル HMAC 計算のみでネットワークを使わないため高速。
      const { segments } = collectPlaylistUris(body);
      const signedMap = await presignPlaylistUris(dir, segments);
      rewritten = rewritePlaylist(body, {
        // S3 モードでは segmentUrl が全件を解決するので base/query は未使用。
        // 万一 Map に無い URI があってもプレイリストを壊さないよう空文字にする。
        segmentBase: '',
        signatureQuery: '',
        playlistUrl,
        segmentUrl: (rel2) => signedMap.get(rel2),
      });
    }

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
