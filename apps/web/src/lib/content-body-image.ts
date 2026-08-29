/**
 * ブログ本文に挿入する画像の検証ロジック (純粋関数のみ)。
 *
 * 保存処理 (prisma / S3 に触るもの) は `content-body-image-store.ts` に分けている。
 * 純粋に保つ理由は video-thumbnail.ts と同じで、
 * jest の testMatch が `.ts` のみのため DB なしでテストできるようにするため。
 *
 * ## なぜ専用の入り口が必要か
 *
 * 本文用の画像アップロードは従来 `POST /api/admin/uploads/image` を使っていたが、
 * このエンドポイントには 2 つの問題があった。
 *
 *   1. `requireCapability('MERCH')` で物販権限を要求していた。
 *      ブログ編集は CONTENT 権限なので、**記事担当者は本文に画像を入れられなかった**
 *      (エディタの画像ボタンを押すと 403)。
 *   2. S3 未設定だと `errors.unprocessable` で即失敗していた。
 *      商品画像・サイト画像・動画サムネイルには DB 保存のフォールバックがあるのに、
 *      本文画像だけ S3 必須という不揃いな状態だった。
 *
 * ここでは CONTENT 権限で使える専用の入り口を用意し、
 * 保存先も他の画像と同じ二段構え (S3 → DB フォールバック) に揃える。
 */

/**
 * 本文画像の上限サイズ。
 *
 * 記事本文に並ぶ画像なので、商品画像・サムネイルと同じ 8MB とする。
 * スマホ写真をそのまま入れても概ね収まり、かつ DB フォールバック時に
 * 1 記事あたりの容量が過大にならない水準。
 */
export const MAX_CONTENT_BODY_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * 受け付ける画像形式 → 拡張子。
 *
 * GIF を許可しているのは、本文では動く画像に意味がある場合があるため
 * (一覧に並ぶ動画サムネイルとは事情が違う)。
 * AVIF は古い iOS Safari で表示できず、会員の端末を選べないので除外する。
 */
export const ALLOWED_CONTENT_BODY_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export type ContentBodyImageValidationError =
  | { kind: 'missing' }
  | { kind: 'type'; message: string }
  | { kind: 'size'; message: string };

export type ContentBodyImageValidationResult =
  | { ok: true; contentType: string; ext: string }
  | { ok: false; error: ContentBodyImageValidationError };

/** 人間に読みやすいサイズ表記 (エラーメッセージ用)。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * アップロードされた画像を検証する。
 *
 * エラーメッセージに「何がダメで、どうすればよいか」を含めるのは、
 * エディタ上ではトーストとして一瞬しか出ないため。
 * 「失敗しました」だけだと運営が原因を特定できない。
 */
export function validateContentBodyImage(params: {
  contentType: string | null | undefined;
  sizeBytes: number;
}): ContentBodyImageValidationResult {
  const { contentType, sizeBytes } = params;

  if (!contentType) {
    return { ok: false, error: { kind: 'missing' } };
  }

  // "image/jpeg; charset=..." のようなパラメータ付きでも受け付ける。
  const normalized = contentType.split(';')[0]!.trim().toLowerCase();
  const ext = ALLOWED_CONTENT_BODY_IMAGE_TYPES[normalized];
  if (!ext) {
    return {
      ok: false,
      error: {
        kind: 'type',
        message:
          '対応していない画像形式です。JPEG / PNG / WebP / GIF のいずれかを選んでください。',
      },
    };
  }

  if (sizeBytes > MAX_CONTENT_BODY_IMAGE_BYTES) {
    return {
      ok: false,
      error: {
        kind: 'size',
        message: `画像サイズは ${formatBytes(MAX_CONTENT_BODY_IMAGE_BYTES)} 以内にしてください（選択された画像は ${formatBytes(sizeBytes)}）。`,
      },
    };
  }

  // 0 バイトのファイルは「壊れた画像」として保存されてしまうので弾く。
  if (sizeBytes <= 0) {
    return {
      ok: false,
      error: { kind: 'size', message: '画像ファイルが空です。別のファイルを選んでください。' },
    };
  }

  return { ok: true, contentType: normalized, ext };
}

/** DB 保存時に `url` として使う内部パス。 */
export function contentBodyImageMediaPath(id: string): string {
  return `/api/media/content-body-image/${id}`;
}
