/**
 * ブログ本文に挿入する「短い動画」の検証ロジック (純粋関数のみ)。
 *
 * 保存処理 (prisma / S3 に触るもの) は `content-body-video-store.ts` に分けている。
 * 純粋に保つ理由は content-body-image.ts と同じで、
 * jest の testMatch が `.ts` のみのため DB なしでテストできるようにするため。
 *
 * ## なぜ既存の Video (VOD) を使わないのか
 *
 * 本文に差し込む数秒〜十数秒のクリップと、VOD の Video テーブルは別物として扱う。
 *
 *   - Video は MediaConvert による HLS エンコードのパイプラインに乗る。
 *     status=UPLOADING → READY まで待ちが発生し、「記事を書きながら
 *     その場で動画を貼る」という用途に対して待ち時間が長すぎる。
 *   - Video は accessLevel / isPublished / publishedAt / expiresAt を
 *     動画自身が持ち、一覧 (/me/videos) にも並ぶ。本文クリップは
 *     「記事の一部」であって単独のコンテンツではないので、一覧に出ると邪魔になる。
 *   - Video の削除は記事本文の <video> を壊すが、その依存関係を追う仕組みがない。
 *
 * そこで本文クリップは ContentBodyImage と全く同じ構造 (S3 → DB フォールバック) の
 * 独立したテーブルに置き、記事本文からは単なる URL として参照する。
 * 記事の公開範囲は記事ページ側が担保するので、本文画像と同じ考え方で一貫する。
 *
 * ## 「短い動画」に限定する理由
 *
 * DB フォールバック保存 (BYTEA) がある以上、無制限のサイズを許すと
 * 1 記事で DB が肥大し、配信のたびに全バイトをメモリに載せることになる。
 * また HLS 化しないため、長尺だとシーク性能もモバイル回線での視聴体験も悪い。
 * 長い動画は従来どおり VOD (動画管理) を使ってもらう。
 */

/**
 * 本文動画の上限サイズ。
 *
 * 本文画像 (8MB) より大きくしたいが、無制限にはできない:
 *   - nginx の client_max_body_size が 50M (deploy/user-data.sh, setup-tls.sh)。
 *     これを超えると Next.js に届く前に 413 になり、原因が分かりにくい。
 *   - DB フォールバック時は BYTEA として保持し、配信時に Buffer へ載せる。
 *
 * 上限を 32MB にすると、nginx の 50M に対して multipart のオーバーヘッド
 * (境界文字列・base64 化されない生バイト + ヘッダ) を載せても余裕があり、
 * かつスマホで撮った 15 秒程度の動画 (1080p でおよそ 20〜30MB) が概ね収まる。
 */
export const MAX_CONTENT_BODY_VIDEO_BYTES = 32 * 1024 * 1024;

/**
 * 想定する最大の長さ (秒)。
 *
 * これはサーバ側では強制しない (バイト列から尺を測るには
 * ffprobe 等が必要で、EC2 に追加依存を入れたくないため)。
 * ブラウザ側で `HTMLVideoElement.duration` を読んで警告に使う、
 * および UI 文言の根拠として用いる。
 */
export const CONTENT_BODY_VIDEO_SOFT_MAX_SECONDS = 60;

/**
 * 受け付ける動画形式 → 拡張子。
 *
 * MP4 (H.264/AAC) を主軸にする。iOS Safari / Android Chrome / PC の主要ブラウザで
 * 追加コーデックなしに再生でき、会員の端末を選ばないため。
 *
 * WebM を併記しているのは、PC で画面収録した素材がそのまま WebM で出ることが
 * 多く、変換を強いると運営の手間になるから。ただし iOS Safari は WebM の
 * サポートが限定的なので、UI 側で「MP4 を推奨」と明示する。
 *
 * QuickTime (.mov) は iPhone の標準出力なので受け付ける。中身が H.264 なら
 * 多くのブラウザで再生できる (ただし HEVC の .mov は再生できない端末があるため、
 * これも UI で MP4 を勧める)。
 *
 * AVI / WMV / MKV は Web で直接再生できない環境が多いので除外する。
 */
export const ALLOWED_CONTENT_BODY_VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/**
 * ブラウザ互換性が万全でない形式。
 * 弾きはしないが、投稿者に注意を出す判断に使う。
 */
const LESS_COMPATIBLE_TYPES = new Set(['video/webm', 'video/quicktime']);

export type ContentBodyVideoValidationError =
  | { kind: 'missing' }
  | { kind: 'type'; message: string }
  | { kind: 'size'; message: string };

export type ContentBodyVideoValidationResult =
  | { ok: true; contentType: string; ext: string }
  | { ok: false; error: ContentBodyVideoValidationError };

/** 人間に読みやすいサイズ表記 (エラーメッセージ用)。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 秒数を「1分5秒」のように表記する (尺の警告用)。 */
export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}秒`;
  return s === 0 ? `${m}分` : `${m}分${s}秒`;
}

/**
 * アップロードされた動画を検証する。
 *
 * 画像側と同様、エラーメッセージには「何がダメで、どうすればよいか」を含める。
 * 動画は特に「形式が対応していない」ケースが多く、単に失敗と言われても
 * 投稿者が次に何をすればよいか分からないため。
 */
export function validateContentBodyVideo(params: {
  contentType: string | null | undefined;
  sizeBytes: number;
}): ContentBodyVideoValidationResult {
  const { contentType, sizeBytes } = params;

  if (!contentType) {
    return { ok: false, error: { kind: 'missing' } };
  }

  // "video/mp4; codecs=..." のようなパラメータ付きでも受け付ける。
  const normalized = contentType.split(';')[0]!.trim().toLowerCase();
  const ext = ALLOWED_CONTENT_BODY_VIDEO_TYPES[normalized];
  if (!ext) {
    return {
      ok: false,
      error: {
        kind: 'type',
        message:
          '対応していない動画形式です。MP4 / WebM / MOV のいずれかを選んでください（MP4 を推奨します）。',
      },
    };
  }

  if (sizeBytes > MAX_CONTENT_BODY_VIDEO_BYTES) {
    return {
      ok: false,
      error: {
        kind: 'size',
        message: `動画サイズは ${formatBytes(MAX_CONTENT_BODY_VIDEO_BYTES)} 以内にしてください（選択された動画は ${formatBytes(sizeBytes)}）。長い動画は「動画管理」からアップロードしてください。`,
      },
    };
  }

  // 0 バイトのファイルは「壊れた動画」として保存されてしまうので弾く。
  if (sizeBytes <= 0) {
    return {
      ok: false,
      error: { kind: 'size', message: '動画ファイルが空です。別のファイルを選んでください。' },
    };
  }

  return { ok: true, contentType: normalized, ext };
}

/**
 * 再生互換性についての注意文。問題がなければ null。
 *
 * 検証を通した後の「弾かないが伝えたいこと」をここに集約する。
 * 呼び出し側 (エディタ) はこれをトーストで出す。
 */
export function contentBodyVideoCompatibilityWarning(
  contentType: string | null | undefined,
): string | null {
  if (!contentType) return null;
  const normalized = contentType.split(';')[0]!.trim().toLowerCase();
  if (!LESS_COMPATIBLE_TYPES.has(normalized)) return null;
  return normalized === 'video/webm'
    ? 'WebM は一部の iPhone / iPad で再生できないことがあります。MP4 に変換して投稿すると確実です。'
    : 'MOV は撮影機種によっては一部の端末で再生できないことがあります。MP4 に変換して投稿すると確実です。';
}

/**
 * 尺が長すぎる場合の注意文。問題がなければ null。
 *
 * 弾かない理由は、尺の測定がブラウザ側の推定であり、
 * メタデータが壊れた動画では Infinity や NaN が返ることがあるため。
 * 「保存できない」より「長いですよ」と伝えるほうが実害が小さい。
 */
export function contentBodyVideoDurationWarning(durationSeconds: number): string | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  if (durationSeconds <= CONTENT_BODY_VIDEO_SOFT_MAX_SECONDS) return null;
  return `この動画は ${formatSeconds(durationSeconds)} あります。本文の動画は ${formatSeconds(CONTENT_BODY_VIDEO_SOFT_MAX_SECONDS)} 以内の短いクリップ向けです。長い動画は「動画管理」からの投稿をおすすめします。`;
}

/** DB 保存時に `url` として使う内部パス。 */
export function contentBodyVideoMediaPath(id: string): string {
  return `/api/media/content-body-video/${id}`;
}
