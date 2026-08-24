/**
 * HLS プレイリスト / セグメント プロキシ
 *
 * `GET /api/videos/<videoId>/hls/index.m3u8`
 * `GET /api/videos/<videoId>/hls/index_720p.m3u8`
 * `GET /api/videos/<videoId>/hls/index_720p_00001.ts`  (S3 モードのみ)
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
 * ## 2 つの配信モード
 *
 * | モード | プレイリスト | セグメント | 追加の AWS 設定 |
 * |---|---|---|---|
 * | `cloudfront` | ここで書き換え | CDN から直接 (署名クエリ付き) | 署名鍵の作成/登録 |
 * | `s3`         | ここで書き換え | **ここで中継** | **不要** |
 *
 * `cloudfront` は帯域を Next.js に通さないので高速だが、署名鍵 3 変数の
 * 設定が必要。`s3` は署名鍵ゼロで動くフォールバックで、セグメントも
 * このルートから配信する。同一オリジンになるため **S3 バケットの CORS
 * 設定も不要** で、AWS 側を一切触らずに再生できる (hls-segment.ts 参照)。
 */
import { NextResponse } from 'next/server';
import { handle, errors } from '@/lib/errors';
import { requirePlayableVideo } from '@/lib/video-access';
import { signVideoUrl, hlsDirPrefix } from '@/lib/cdn-signer';
import { extractSignatureQuery, rewritePlaylist, isPlaylistUri } from '@/lib/hls-rewrite';
import { currentDeliveryMode, presignS3Get } from '@/lib/video-delivery';
import {
  buildSegmentHeaders,
  hlsSegmentProxyUrl,
  playlistRelativeDir,
} from '@/lib/hls-segment';
import { env } from '@/lib/env';
import { VIDEO_SIGNED_URL_TTL_SEC } from '@idol/shared';

export const runtime = 'nodejs';
/** 署名クエリを含むためキャッシュ不可 */
export const dynamic = 'force-dynamic';

/** プレイリスト取得のタイムアウト (ms) */
const FETCH_TIMEOUT_MS = 8000;
/**
 * セグメント取得のヘッダ待ちタイムアウト (ms)。
 * プレイリストより緩めにする (大きめのセグメントで最初のバイトまでに
 * 時間がかかることがある)。本文の転送中には作用しない。
 */
const SEGMENT_TIMEOUT_MS = 20000;

export const GET = handle(
  async (req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }) => {
    const { id, path } = await ctx.params;
    const rel = (path ?? []).join('/');

    if (!rel) {
      throw errors.badRequest('パスが指定されていません');
    }
    // ディレクトリトラバーサル防止
    if (rel.includes('..') || rel.startsWith('/')) {
      throw errors.badRequest('不正なパスです');
    }

    const { video } = await requirePlayableVideo(req, id);

    // 配信経路を決定する。CloudFront 署名鍵が無くても、HLS 出力バケットが
    // 分かっていれば S3 から配信できる (video-delivery.ts)。
    const mode = currentDeliveryMode();
    if (mode === 'none') {
      throw errors.internal(
        '動画の配信先が設定されていません。管理者にお問い合わせください。',
      );
    }

    // 要求されたファイルは、この動画の HLS ディレクトリ配下に限定する
    const dir = hlsDirPrefix(video.s3HlsKey);
    const targetKey = `${dir}${rel}`;

    // ---- セグメント (.ts 等) のリクエスト ----
    //
    // CloudFront モードでは、プレイリストの書き換えでセグメントを
    // CDN の絶対URL (署名付き) に差し替えているため、ここには来ない。
    // 万一来た場合は CDN 経路を使わせるためエラーにする。
    //
    // S3 モードでは **自サーバ経由でストリーム中継する**。
    // こうする理由は CORS を不要にするため:
    //   S3 のプリサインド URL をプレイリストに埋めるとブラウザが
    //   S3 ドメインへクロスオリジンで XHR するため、出力バケットに
    //   CORS 許可が必要になる (= インフラ側の追加デプロイが必要)。
    //   自サーバから配れば同一オリジンなので CORS 設定なしで再生できる。
    if (!isPlaylistUri(rel)) {
      if (mode !== 's3') {
        throw errors.badRequest('プレイリスト (.m3u8) のみ取得できます');
      }
      return streamSegment(req, targetKey, rel);
    }

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

    // このプレイリスト自身が HLS ディレクトリ内のどこに在るか。
    // 通常 (MediaConvert 既定出力) は全ファイルが同一階層なので空文字だが、
    // レンディションをサブディレクトリに置く構成では
    // `720p/` のようになり、中の URI はそこからの相対になる。
    const relDir = playlistRelativeDir(rel);

    // ネストされた variant playlist は相対パスのまま残す。
    // このルート自身が `/api/videos/<id>/hls/...` で配信されるため、
    // 相対解決すると再びこのプロキシに入り、そこで再署名される。
    const playlistUrl = (relativePath: string) => relativePath;

    let rewritten: string;
    if (mode === 'cloudfront') {
      const signatureQuery = extractSignatureQuery(upstreamUrl);
      rewritten = rewritePlaylist(body, {
        segmentBase: `https://${env.cloudfront.videoDomain}/${dir}${relDir}`,
        signatureQuery,
        playlistUrl,
      });
    } else {
      // S3 モード: セグメントを **このプロキシ自身の URL** に書き換える。
      //
      // ここで S3 プリサインド URL を直接埋め込まないのが重要な点。
      // 埋め込むとブラウザが S3 ドメインへクロスオリジンでセグメントを
      // 取得するため、出力バケットに CORS 許可が必要になり、
      // AWS 側の追加デプロイ (`cdk deploy '*-storage'`) が発生してしまう。
      // 自サーバの URL にしておけば同一オリジンなので CORS は一切不要で、
      // 署名は上の segment 分岐でサーバ内部だけで行われる。
      rewritten = rewritePlaylist(body, {
        // segmentUrl が全件を解決するので base/query は未使用。
        segmentBase: '',
        signatureQuery: '',
        playlistUrl,
        segmentUrl: (rel2) => hlsSegmentProxyUrl(id, `${relDir}${rel2}`),
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

/**
 * セグメント (`.ts` / `.m4s` / 暗号鍵 等) を S3 から取得し、
 * **ボディをストリームのまま** クライアントへ中継する。
 *
 * ## 実装上の要点
 *
 * 1. **ストリーミング必須**
 *    `await upstream.arrayBuffer()` にすると 1 セグメント (数 MB) を
 *    サーバのメモリに丸ごと載せてしまう。同時視聴者が増えるとメモリを
 *    食い潰すため、`upstream.body` (ReadableStream) をそのまま渡す。
 *
 * 2. **Range ヘッダの転送**
 *    プレイヤーはシークやバイトレンジ形式の HLS (`#EXT-X-BYTERANGE`) で
 *    `Range: bytes=...` を送ってくる。これを S3 に転送し、返ってきた
 *    `206 Partial Content` と `Content-Range` をそのまま返す。
 *    落とすとシークが壊れる (特に iOS のネイティブ HLS)。
 *
 * 3. **タイムアウトはヘッダ受信までに限定**
 *    `AbortController` を本文転送中も生かしておくと、大きいセグメントの
 *    転送が途中で中断される。ヘッダが返ってきた時点で `clearTimeout` する。
 *
 * 4. **クライアント切断の伝播**
 *    ユーザーがシークや離脱をすると `req.signal` が abort される。
 *    これを上流 fetch に繋いでおくことで、無駄な S3 転送を即座に止める。
 */
async function streamSegment(
  req: Request,
  targetKey: string,
  relativePath: string,
): Promise<NextResponse> {
  // 署名はローカル計算 (HMAC) のみでネットワークアクセスを伴わない
  const signedUrl = await presignS3Get(targetKey);

  const controller = new AbortController();
  // クライアントが切断したら上流もキャンセルする
  const onAbort = () => controller.abort();
  req.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), SEGMENT_TIMEOUT_MS);

  // Range はそのまま S3 へ転送する (シーク/バイトレンジ HLS 対応)
  const forwarded: Record<string, string> = {};
  const range = req.headers.get('range');
  if (range) forwarded['range'] = range;
  const ifRange = req.headers.get('if-range');
  if (ifRange) forwarded['if-range'] = ifRange;

  let upstream: Response;
  try {
    upstream = await fetch(signedUrl, {
      headers: forwarded,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw errors.internal('動画セグメントの取得がタイムアウトしました');
    }
    throw e;
  } finally {
    // ヘッダが返った時点で解除する。本文転送はタイムアウトの対象外。
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onAbort);
  }

  if (!upstream.ok && upstream.status !== 206) {
    if (upstream.status === 403 || upstream.status === 404) {
      throw errors.notFound('動画セグメントが見つかりません');
    }
    throw errors.internal(`動画セグメントを取得できませんでした (${upstream.status})`);
  }

  // ボディはバッファせずそのまま流す (メモリ節約 + 再生開始の高速化)
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: buildSegmentHeaders(upstream.headers, relativePath),
  });
}
