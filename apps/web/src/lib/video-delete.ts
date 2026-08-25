/**
 * 動画削除で「S3 の何を消すか」を決める純粋ロジック。
 *
 * S3 に触る副作用は API ルート側 (`api/admin/videos/[id]/route.ts` の DELETE) に置き、
 * ここは入力 → 削除対象の対応だけを持つ。理由は 2 つ:
 *   1. 消す対象を間違えると **他の動画のファイルまで消える** 不可逆な事故になるため、
 *      DB も S3 も無しでテストできる形にしておきたい。
 *   2. jest の testMatch は `.ts` のみなので、純粋関数に寄せればそのままテストできる。
 *
 * ## 動画 1 本が持つ S3 上の実体
 *
 * | 実体 | バケット | キー |
 * |---|---|---|
 * | ソース動画 (アップロード原本) | `S3_VIDEO_BUCKET` | `Video.s3SourceKey` |
 * | HLS 出力 (m3u8 / ts / コマ画像) | `S3_MEDIA_OUTPUT_BUCKET` | `hls/<videoId>/` 配下 |
 * | 手動アップロードのサムネイル | `S3_ASSET_BUCKET` | `video-thumbnails/<videoId>/` 配下 |
 *
 * ## なぜ thumbnailUrl をパースしないのか
 *
 * `thumbnailUrl` は 3 形態 (S3キー / 絶対URL / 内部パス) を取るため、
 * URL からバケットとキーを逆算しようとすると
 *   - CloudFront ドメイン経由かS3直かで形が変わる
 *   - 運営が指定した「外部サイトの画像URL」を誤って自バケットのキーと解釈する
 * といった分岐が増え、間違えたときの影響が大きい。
 *
 * 一方、自前でアップロードしたサムネイルは
 * `video-thumbnails/<videoId>/<uuid>.<ext>` (video-thumbnail-store.ts) と
 * **videoId で名前空間が切られている**。差し替えるたびに UUID が変わるため
 * 過去分が残っている可能性もあるが、プレフィックス削除ならまとめて消える。
 * よって「URL を解釈する」のではなく「videoId 配下を消す」方式を採る。
 *
 * 絶対URLが外部サイトを指している場合は、自バケットに実体が無いだけなので
 * プレフィックス削除は 0 件ヒットで無害に終わる。
 *
 * ## DB 側について
 *
 * `VideoViewLog` / `VideoThumbnail` は schema.prisma で `onDelete: Cascade` を
 * 宣言済みなので、`prisma.video.delete` だけで一緒に消える。ここでは扱わない。
 */

/** 動画 1 本を削除するときに消すべき S3 上の対象。 */
export type VideoDeletionPlan = {
  /** ソース動画のキー (video バケット)。未設定なら null。 */
  sourceKey: string | null;
  /** HLS 出力のプレフィックス (mediaOutput バケット)。必ず末尾 `/` 付き。 */
  hlsPrefix: string;
  /** 手動アップロードしたサムネイルのプレフィックス (asset バケット)。必ず末尾 `/` 付き。 */
  thumbnailPrefix: string;
};

/**
 * HLS 出力のプレフィックス。
 *
 * 末尾 `/` は必須。付けないと `hls/abc` が `hls/abcdef/...` にも前方一致してしまい、
 * 別の動画のセグメントを巻き込んで削除する
 * (`deleteByPrefix` 側でも末尾 `/` を強制している)。
 */
export function hlsPrefixFor(videoId: string): string {
  return `hls/${videoId}/`;
}

/** 手動アップロードしたサムネイルのプレフィックス (video-thumbnail-store.ts と対応)。 */
export function thumbnailPrefixFor(videoId: string): string {
  return `video-thumbnails/${videoId}/`;
}

/**
 * 削除対象を組み立てる。
 *
 * `s3SourceKey` が空文字 / 空白のみのケースを null に正規化するのは、
 * そのまま `DeleteObject` に渡すと `Key` 必須エラーで削除処理全体が
 * 落ちてしまうため (アップロード途中で中断した動画に起こり得る)。
 */
export function buildVideoDeletionPlan(video: {
  id: string;
  s3SourceKey: string | null;
}): VideoDeletionPlan {
  const source = video.s3SourceKey?.trim();
  return {
    sourceKey: source ? source : null,
    hlsPrefix: hlsPrefixFor(video.id),
    thumbnailPrefix: thumbnailPrefixFor(video.id),
  };
}

/**
 * 削除確認の入力チェック。
 *
 * ボタン 1 つ + confirm ダイアログだけだと、一覧で行を押し間違えたまま
 * 反射的に OK を押してしまう。動画の削除は S3 の実体ごと消える不可逆操作で
 * 復旧手段が無いため、**タイトルを手で打たせて対象を再確認させる**。
 *
 * 前後の空白は無視する (コピー&ペーストで末尾に空白が付くことがあるため)。
 * タイトルが空の動画は理論上存在しない (API/DB とも必須) が、
 * 万一空だった場合に「空入力で削除できてしまう」のを防ぐため false を返す。
 */
export function isDeleteConfirmationValid(input: string, title: string): boolean {
  const expected = title.trim();
  if (!expected) return false;
  return input.trim() === expected;
}
