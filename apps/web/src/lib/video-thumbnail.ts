/**
 * 動画サムネイルの判定・検証ロジック (純粋関数のみ)。
 *
 * 保存処理 (prisma / S3 に触るもの) は `video-thumbnail-store.ts` に分けている。
 * ここを純粋に保つ理由は 2 つ:
 *   1. `video-delivery.ts` (表示側) が `classifyThumbnailValue` を使うため、
 *      prisma を import すると表示経路に DB クライアントが引き込まれる。
 *   2. jest の testMatch は `.ts` のみなので、検証ロジックを純粋関数に
 *      寄せておけば DB もモックも無しでテストできる。
 *
 * ## なぜ必要か
 *
 * `Video.thumbnailUrl` はこれまで **エンコードパイプライン専用** の列だった。
 * 書き込むのは 2 箇所だけ:
 *   - `api/admin/videos/job-complete` … MediaConvert 完了通知
 *   - `api/admin/videos/[id]/sync`    … 手動同期
 * どちらも `hls/<videoId>/thumbnail.0000000.jpg` という S3 キーを入れる。
 *
 * つまり **運営が任意の画像を指定する手段が存在しなかった**。
 * MediaConvert がサムネイルを出力しなかった動画は永久にプレースホルダーのままで、
 * 自動生成されたコマが不適切 (目を閉じている等) でも差し替えられなかった。
 *
 * ## 保存先の決定 (SiteImage / ProductImage / GameAudio と同じ二段構え)
 *
 *   1. `S3_ASSET_BUCKET` 設定済み → S3 へ PUT し、`thumbnailUrl` は外部 URL。
 *      旧い DB 保存分は削除する。
 *   2. 未設定 → バイト列を `VideoThumbnail` テーブルに保存し、
 *      `thumbnailUrl` は `/api/media/video-thumbnail/<id>?v=<updatedAt>`。
 *
 * ローカルディスク (`public/uploads/...`) は採用しない。standalone build では
 * 配信ディレクトリ (`.next/standalone/apps/web/public`) と書き込み先がズレ、
 * 再ビルドで消え、PM2 cluster 間で不整合になる。
 *
 * ## なぜ動画バケット (S3_MEDIA_OUTPUT_BUCKET) ではなくアセットバケットか
 *
 * 出力バケットは `BlockPublicAccess.BLOCK_ALL` かつ EC2 ロールに **読み取り権限しか無い**
 * (`infra/lib/ec2-stack.ts` の `mediaOutputBucket.grantRead(role)`)。
 * 書き込もうとすると AccessDenied になり、権限を足すには `cdk deploy` が必要。
 * 一方アセットバケットは `grantReadWrite` 済みなので **AWS 側の追加作業ゼロ** で書ける。
 * サムネイルは `<img src>` で単純 GET されるだけなので CORS も不要
 * (動画セグメントと違いクロスオリジンで問題にならない)。
 */

/** サムネイル画像の上限サイズ。一覧に並ぶ小さな画像なので 8MB で十分。 */
export const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;

/**
 * 受け付ける画像形式 → 拡張子。
 *
 * GIF / AVIF は `product-image.ts` では許可しているが、サムネイルでは除外する。
 * アニメーション GIF が一覧で動き回ると視覚的に騒がしく、AVIF は古い
 * iOS Safari で表示できないため (会員の端末は選べない)。
 */
export const ALLOWED_THUMBNAIL_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** `thumbnailUrl` に入り得る値の種類。 */
export type ThumbnailKind =
  /** http(s) から始まる絶対 URL (S3 アセット / CloudFront / 外部サイト) */
  | 'absolute'
  /** 自サーバの内部パス (`/api/media/video-thumbnail/...` 等) */
  | 'internal'
  /** 出力バケット内の S3 キー (エンコードパイプラインが設定するもの) */
  | 's3key';

/**
 * `thumbnailUrl` の値がどの種類かを判定する。
 *
 * 表示側 (`resolveThumbnailUrlAsync`) は「絶対URLならそのまま、
 * それ以外は S3 キーとして署名」という 2 分岐だったため、
 * `/api/media/...` のような内部パスを渡すと **S3 キーとして署名されて壊れる**。
 * その分岐を増やすために種類を明示的に返す。
 */
export function classifyThumbnailValue(value: string): ThumbnailKind {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return 'absolute';
  if (v.startsWith('/')) return 'internal';
  return 's3key';
}

/** 内部配信パス (キャッシュバスター付き)。 */
export function videoThumbnailMediaPath(videoId: string, version: number | Date): string {
  const v = version instanceof Date ? version.getTime() : version;
  return `/api/media/video-thumbnail/${encodeURIComponent(videoId)}?v=${v}`;
}

/**
 * 運営が手入力した URL を検証する。
 *
 * 「アップロードできない環境でも URL 直接指定で回避できる」導線を残したいが、
 * 任意文字列をそのまま `<img src>` に流すと `javascript:` 等が入り得るため
 * **http(s) のみ** に限定する。空文字列は「サムネイルを外す」意思表示として許す。
 */
export type ThumbnailUrlCheck = { ok: true; value: string | null } | { ok: false; message: string };

export function validateThumbnailUrlInput(raw: string): ThumbnailUrlCheck {
  const v = raw.trim();
  if (!v) return { ok: true, value: null };
  if (v.startsWith('/api/media/video-thumbnail/')) {
    // 自分自身がアップロード結果として返した内部パスの再送はそのまま通す
    // (編集フォームが「変更なし」でも値を送ってしまうケースを弾かないため)。
    return { ok: true, value: v };
  }
  if (!/^https?:\/\//i.test(v)) {
    return { ok: false, message: 'サムネイルURLは http:// または https:// で始めてください' };
  }
  if (v.length > 2000) {
    return { ok: false, message: 'サムネイルURLが長すぎます' };
  }
  return { ok: true, value: v };
}

/** アップロードされたファイルのバリデーション結果。 */
export type ThumbnailFileCheck = { ok: true; ext: string } | { ok: false; message: string };

export function validateThumbnailFile(contentType: string, sizeBytes: number): ThumbnailFileCheck {
  const ext = ALLOWED_THUMBNAIL_TYPES[contentType];
  if (!ext) {
    return { ok: false, message: '対応していない画像形式です (JPEG / PNG / WebP)' };
  }
  if (sizeBytes <= 0) {
    return { ok: false, message: '画像ファイルが空です' };
  }
  if (sizeBytes > MAX_THUMBNAIL_BYTES) {
    return { ok: false, message: '画像サイズは 8MB 以内にしてください' };
  }
  return { ok: true, ext };
}
