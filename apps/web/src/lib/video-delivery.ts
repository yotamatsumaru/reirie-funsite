/**
 * 動画配信URLの解決 (CloudFront 署名付き URL / S3 プリサインド URL の二段構え)
 *
 * ## なぜこのファイルが必要か
 *
 * 従来、動画の配信URLは **CloudFront 署名付き URL 一本槍** だった。
 * そのため以下 3 つが全て揃っていないと再生が一切できなかった。
 *
 *   - `CLOUDFRONT_VIDEO_DOMAIN`
 *   - `CLOUDFRONT_KEY_PAIR_ID`
 *   - `CLOUDFRONT_PRIVATE_KEY`
 *
 * ところがこの 3 つのうち **`KEY_PAIR_ID` / `PRIVATE_KEY` は自動では用意されない**。
 * CDK (`infra/lib/storage-stack.ts`) は `cloudfrontPublicKeyPem` を context で
 * 渡したときだけ PublicKey / KeyGroup を作る作りになっており、`infra/cdk.json`
 * にその context は入っていない。さらに秘密鍵の SSM 登録 (`cloudfront/private-key`)
 * は手動手順である。結果として「エンコードは成功し READY になるのに、
 * 再生ボタンを押すと『CloudFront 署名付き URL が未設定です』になる」という
 * 状態が既定で発生していた。
 *
 * ## 解決方針
 *
 * HLS の出力先バケット (`S3_MEDIA_OUTPUT_BUCKET`) には、EC2 インスタンス
 * ロールが既に読み取り権限を持っている (`mediaOutputBucket.grantRead(role)`)。
 * つまり **アプリは S3 プリサインド URL を自力で発行できる**。
 * そこで配信経路を次の優先順で選ぶようにする。
 *
 *   1. `cloudfront` … CloudFront 署名鍵が揃っている場合 (本来の推奨経路。
 *                      CDN キャッシュが効き、帯域も安い)
 *   2. `s3`         … 署名鍵が無い場合のフォールバック。出力バケットから
 *                      S3 プリサインド URL で直接配信する。追加の AWS 設定は不要
 *   3. `none`       … 出力バケットすら未設定。ここで初めてエラーにする
 *
 * ## CloudFront と S3 の決定的な違い (実装上の注意)
 *
 * CloudFront はカスタムポリシーで `hls/<videoId>/*` という **ワイルドカード**
 * を署名できるため、1 つの署名クエリを全セグメントで共有できる。
 * 一方 **S3 プリサインド URL はオブジェクト 1 つごとに署名が必要** で、
 * 共有クエリという概念が無い。
 *
 * ## S3 プリサインド URL をブラウザに渡さない理由 (CORS)
 *
 * 当初は「セグメント 1 本ごとにプリサインドして、その URL をプレイリストに
 * 埋め込む」実装にしていた。しかしこれだとブラウザが
 * `https://<bucket>.s3.<region>.amazonaws.com/...` へ **クロスオリジン**で
 * セグメントを取りに行くため、出力バケットに CORS 許可が必要になる。
 * CORS を付けるには `cdk deploy` (= AWS 側の追加作業) が必要で、
 * 「AWS を触らずに再生できるようにする」という要件を満たせない。
 *
 * そこで **プリサインド URL はサーバ内部でしか使わない**。
 * セグメントは `/api/videos/<id>/hls/<file>` から自サーバが中継して配信し、
 * ブラウザから見れば全て同一オリジンになる (CORS 設定は一切不要)。
 * 詳細は `hls-segment.ts` と HLS プロキシルートを参照。
 *
 * その結果このファイルが公開する非同期署名は
 *   - プレイリスト本体の取得 (サーバ→S3)
 *   - セグメント中継時の取得 (サーバ→S3)
 *   - サムネイル (これは `<img src>` で単純 GET されるだけなので
 *     クロスオリジンでも CORS 不要 = そのままブラウザに渡してよい)
 * の 3 用途のみとなる。
 */
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as s3SignedUrl } from '@aws-sdk/s3-request-presigner';
import { VIDEO_SIGNED_URL_TTL_SEC } from '@idol/shared';
import { env } from './env';
import { s3 } from './s3';
import { isVideoCdnConfigured, signVideoUrl, hlsDirPrefix } from './cdn-signer';

/**
 * 配信経路。
 * - `cloudfront`: CloudFront 署名付き URL (推奨)
 * - `s3`        : S3 プリサインド URL (フォールバック)
 * - `none`      : 配信不能 (出力バケットも未設定)
 */
export type DeliveryMode = 'cloudfront' | 's3' | 'none';

export type DeliveryConfig = {
  /** CloudFront の 3 変数が揃っているか */
  cloudfrontReady: boolean;
  /** HLS 出力先バケット名 (未設定なら空文字) */
  outputBucket: string;
};

/**
 * 設定値から配信経路を決める純粋関数。
 *
 * CloudFront を優先するのは、CDN キャッシュが効いて転送量課金も安く、
 * かつ署名がワイルドカードで済むため。S3 は「設定漏れでも再生できる」
 * ことを保証するための保険であり、性能面では劣る。
 */
export function resolveDeliveryMode(cfg: DeliveryConfig): DeliveryMode {
  if (cfg.cloudfrontReady) return 'cloudfront';
  if (cfg.outputBucket) return 's3';
  return 'none';
}

/**
 * 配信できない (`none`) ときに、何を設定すれば直るかを列挙する。
 *
 * 「CloudFront を設定する」「S3 出力バケットを設定する」のどちらでも
 * 直るため、両方を提示する。管理者向けの診断表示に使う。
 */
export function missingDeliveryConfig(cfg: DeliveryConfig): string[] {
  if (resolveDeliveryMode(cfg) !== 'none') return [];
  return [
    'S3_MEDIA_OUTPUT_BUCKET (または S3_VIDEO_BUCKET)',
    'CLOUDFRONT_VIDEO_DOMAIN + CLOUDFRONT_KEY_PAIR_ID + CLOUDFRONT_PRIVATE_KEY',
  ];
}

/** 現在の環境変数から配信設定を組み立てる */
export function currentDeliveryConfig(): DeliveryConfig {
  return {
    cloudfrontReady: isVideoCdnConfigured(),
    // mediaOutputBucket は env 側で videoBucket にフォールバック済み
    outputBucket: env.s3.mediaOutputBucket,
  };
}

/** 現在の配信経路 */
export function currentDeliveryMode(): DeliveryMode {
  return resolveDeliveryMode(currentDeliveryConfig());
}

/**
 * 何らかの経路で動画を配信できるか。
 *
 * 旧 `isVideoCdnConfigured()` を再生ゲートに使っていた箇所は、
 * S3 フォールバックを活かすためこちらに置き換える。
 */
export function isVideoDeliveryConfigured(): boolean {
  return currentDeliveryMode() !== 'none';
}

/**
 * S3 オブジェクトのプリサインド GET URL を発行する。
 *
 * 出力バケットは `BlockPublicAccess.BLOCK_ALL` なので、
 * この署名付き URL 以外では絶対に取得できない (公開はされない)。
 */
export async function presignS3Get(
  key: string,
  ttlSec: number = VIDEO_SIGNED_URL_TTL_SEC,
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: env.s3.mediaOutputBucket,
    Key: key.replace(/^\/+/, ''),
  });
  return s3SignedUrl(s3(), cmd, { expiresIn: ttlSec });
}

export type SignedObject = {
  url: string;
  expiresAt: Date;
  mode: DeliveryMode;
};

/**
 * 単一オブジェクト (プレイリスト / サムネイル等) の配信URLを解決する。
 *
 * CloudFront が使える場合はワイルドカード署名を避け、
 * `wildcard` 引数で呼び出し側が指定できるようにしている
 * (サムネイルは単独ファイル署名にしないと、同ディレクトリの
 *  動画セグメントまで許可してしまう)。
 */
export async function resolveObjectUrl(
  key: string,
  ttlSec: number = VIDEO_SIGNED_URL_TTL_SEC,
  wildcard = true,
): Promise<SignedObject | null> {
  const mode = currentDeliveryMode();
  const expiresAt = new Date(Date.now() + ttlSec * 1000);

  if (mode === 'cloudfront') {
    const signed = signVideoUrl(key, ttlSec, wildcard);
    return { url: signed.url, expiresAt: signed.expiresAt, mode };
  }
  if (mode === 's3') {
    return { url: await presignS3Get(key, ttlSec), expiresAt, mode };
  }
  return null;
}

/**
 * 動画サムネイルの表示用 URL を解決する (S3 フォールバック対応版)。
 *
 * `cdn-signer.ts` の `resolveThumbnailUrl` は CloudFront 専用で、
 * 署名鍵が無いと `null` を返す = 本番でサムネイルが全部
 * プレースホルダになってしまう。こちらは S3 プリサインドに
 * フォールバックするため、鍵が無くてもサムネイルが表示される。
 *
 * - `http(s)://` で始まる値 (手動設定した外部URL) はそのまま返す
 * - どの経路でも配信できない場合のみ `null`
 */
export async function resolveThumbnailUrlAsync(
  value: string | null | undefined,
  ttlSec: number = VIDEO_SIGNED_URL_TTL_SEC,
): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  // サムネイルは単独ファイルなので wildcard=false (canned policy)
  const res = await resolveObjectUrl(value.replace(/^\/+/, ''), ttlSec, false);
  return res?.url ?? null;
}

/**
 * 複数のサムネイルを並列に解決する (一覧画面用)。
 *
 * 一覧では N 件のサムネイルを署名する必要があるが、S3 プリサインドは
 * 非同期なので逐次 await すると N 回のラウンドトリップ相当の遅延になる。
 * `Promise.all` でまとめる。
 */
export async function resolveThumbnailUrls(
  values: Array<string | null | undefined>,
  ttlSec: number = VIDEO_SIGNED_URL_TTL_SEC,
): Promise<Array<string | null>> {
  return Promise.all(values.map((v) => resolveThumbnailUrlAsync(v, ttlSec)));
}

/** 再エクスポート (呼び出し側の import を 1 箇所にまとめるため) */
export { hlsDirPrefix };
