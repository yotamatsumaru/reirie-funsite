import { getSignedUrl as cfSignedUrl } from '@aws-sdk/cloudfront-signer';
import { env } from './env';
import { VIDEO_SIGNED_URL_TTL_SEC } from '@idol/shared';

/** CloudFront 署名付き URL を発行できる設定が揃っているか */
export function isVideoCdnConfigured(): boolean {
  const { videoDomain, keyPairId, privateKey } = env.cloudfront;
  return Boolean(videoDomain && keyPairId && privateKey);
}

/**
 * 与えられたキーが属する「HLS 出力ディレクトリ」を返す。
 *
 * 例: `hls/vid123/index.m3u8` → `hls/vid123/`
 *
 * HLS 再生ではマスタープレイリストと同じ階層にある
 * variant プレイリスト (`index_720p.m3u8`) とセグメント (`*.ts`) を
 * プレイヤーが個別に取得するため、この階層全体を署名対象にする。
 */
export function hlsDirPrefix(s3HlsKey: string): string {
  const key = s3HlsKey.replace(/^\/+/, '');
  const idx = key.lastIndexOf('/');
  return idx >= 0 ? key.slice(0, idx + 1) : '';
}

/**
 * CloudFront カスタムポリシー (ワイルドカード) を組み立てる。
 *
 * canned policy (dateLessThan だけの署名) は **1 つの URL にしか効かない**。
 * HLS はプレイリストとは別に `.ts` セグメントを個別リクエストするため、
 * canned policy ではセグメントが 403 になり「プレイリストは読めるのに
 * 映像が再生されない」という症状になる。
 * そこで `hls/<videoId>/*` をリソースにしたカスタムポリシーで署名する。
 */
function buildWildcardPolicy(resource: string, expiresAtSec: number): string {
  return JSON.stringify({
    Statement: [
      {
        Resource: resource,
        Condition: { DateLessThan: { 'AWS:EpochTime': expiresAtSec } },
      },
    ],
  });
}

/**
 * CloudFront 署名付きURL (HLS 用)
 *
 * ## 重要: セグメントまで再生できるようにする
 * 返す URL のクエリ (`Policy` / `Signature` / `Key-Pair-Id`) は
 * `hls/<videoId>/*` 全体に対して有効なカスタムポリシー署名である。
 * プレイヤー側 (HlsPlayer) が同じクエリをセグメント要求にも引き継ぐことで、
 * `.ts` セグメントも 200 で取得できる。
 *
 * `signed: false` の場合は署名設定が未完了で、返した URL では実際には再生できない
 * (CloudFront が 403 を返す)。呼び出し側でユーザーに明示するために使う。
 * 開発環境では非署名のダミーURLを返す。
 *
 * @param wildcard true (既定) なら配下すべてを対象にする。
 *                 サムネイルのような単独ファイルは false でよい。
 */
export function signVideoUrl(
  s3HlsKey: string,
  ttlSec: number = VIDEO_SIGNED_URL_TTL_SEC,
  wildcard = true,
): { url: string; expiresAt: Date; signed: boolean } {
  const { videoDomain, keyPairId, privateKey } = env.cloudfront;
  const expiresAt = new Date(Date.now() + ttlSec * 1000);

  if (!videoDomain || !keyPairId || !privateKey) {
    return {
      url: `https://${videoDomain || 'dev-cdn.example.com'}/${s3HlsKey}?dev=1`,
      expiresAt,
      signed: false,
    };
  }

  const key = s3HlsKey.replace(/^\/+/, '');
  const url = `https://${videoDomain}/${key}`;
  const pk = privateKey.replace(/\\n/g, '\n');

  if (!wildcard) {
    // 単独ファイル (サムネイル等) は canned policy で十分
    return {
      url: cfSignedUrl({
        url,
        keyPairId,
        privateKey: pk,
        dateLessThan: expiresAt.toISOString(),
      }),
      expiresAt,
      signed: true,
    };
  }

  // HLS: 同一ディレクトリ配下 (variant playlist + .ts) をまとめて許可
  const resource = `https://${videoDomain}/${hlsDirPrefix(key)}*`;
  const policy = buildWildcardPolicy(
    resource,
    Math.floor(expiresAt.getTime() / 1000),
  );
  return {
    url: cfSignedUrl({ url, keyPairId, privateKey: pk, policy }),
    expiresAt,
    signed: true,
  };
}

/**
 * 動画サムネイルの表示用 URL を解決する。
 *
 * MediaConvert が出力するサムネイルは非公開の出力バケットに置かれるため、
 * DB には S3 キー (例 `hls/<videoId>/thumbnail.0000000.jpg`) を保存し、
 * 表示時に CloudFront 署名付き URL へ変換する。
 *
 * - `http(s)://` から始まる値 (管理画面から手動で設定した外部URL等) はそのまま返す
 * - 署名設定が未完了なら null を返す (壊れた画像を出さずプレースホルダにフォールバック)
 *
 * @param value DB の Video.thumbnailUrl
 */
export function resolveThumbnailUrl(
  value: string | null | undefined,
  ttlSec: number = VIDEO_SIGNED_URL_TTL_SEC,
): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!isVideoCdnConfigured()) return null;
  // サムネイルは単独ファイルなので canned policy (wildcard=false) で署名する。
  // ワイルドカードにすると同ディレクトリの動画セグメントまで許可してしまうため。
  const { url } = signVideoUrl(value.replace(/^\/+/, ''), ttlSec, false);
  return url;
}
