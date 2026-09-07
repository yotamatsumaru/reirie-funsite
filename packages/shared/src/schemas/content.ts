import { z } from 'zod';
import { ACCESS_LEVELS } from '../constants';

export const ContentTypeSchema = z.enum(['BLOG', 'GALLERY']);
export const ContentStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export const ListContentsQuerySchema = z.object({
  type: ContentTypeSchema.optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export type ListContentsQuery = z.infer<typeof ListContentsQuerySchema>;

export const CreateContentSchema = z.object({
  type: ContentTypeSchema,
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, 'slugは英小文字/数字/ハイフンのみ'),
  title: z.string().min(1).max(200),
  excerpt: z.string().max(500).optional(),
  body: z.string(),
  coverImageUrl: z.url().optional(),
  accessLevel: z.enum(ACCESS_LEVELS).default('PUBLIC'),
  status: ContentStatusSchema.default('DRAFT'),
  publishedAt: z.iso.datetime().optional(),
  authorName: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /**
   * ギャラリーに並べる画像 URL。
   *
   * `z.url()` を使わない理由 (重要):
   * 画像アップロード API (/api/admin/contents/images) は S3 未設定の環境で
   * `/api/media/content-body-image/<uuid>` という **相対パス** を返す。
   * `z.url()` は絶対 URL しか通さないため、
   * 「アップロードは成功するのに、その URL を登録すると 400」という
   * 状態になっていた (S3 設定済みの本番では通るので気付きにくい)。
   *
   * ここでは緩く string として受け、
   * `javascript:` などの危険なスキームの排除と正規化は
   * apps/web の lib/gallery.ts (normalizeGalleryImageUrls) が行う。
   * 検証を apps 側に置くのは、許可する形 (自サーバの配信パス) が
   * Web アプリのルーティングに依存する知識だからである。
   */
  imageUrls: z.array(z.string()).optional(),
  /** ギャラリー画像のキャプション。imageUrls と同じ順序で対応する。 */
  imageCaptions: z.array(z.string().max(200)).optional(),
  /**
   * ギャラリーの «アルバム» 名。
   *
   * nullable にしている理由: 一度付けたアルバム名を «外す» 操作が必要で、
   * undefined (キーを送らない) は「変更しない」を意味するため
   * 区別できる値が要る。null が来たら未設定に戻す。
   *
   * 前後の空白の除去は apps/web の lib/gallery-album.ts が行う
   * (空白のみの入力を «未設定» に寄せる判断は表示側の知識なので)。
   */
  album: z.string().max(60).nullable().optional(),
});
export type CreateContentInput = z.infer<typeof CreateContentSchema>;

export const UpdateContentSchema = CreateContentSchema.partial();
export type UpdateContentInput = z.infer<typeof UpdateContentSchema>;

export const RequestVideoUrlSchema = z.object({
  videoId: z.uuid(),
});

export const VideoSignedUrlResponseSchema = z.object({
  hlsUrl: z.url(),
  expiresAt: z.iso.datetime(),
});

export const CreateVideoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  s3SourceKey: z.string().min(1),
  accessLevel: z.enum(ACCESS_LEVELS).default('MEMBERS'),
  /**
   * 公開開始日時。未来の日時を入れると「公開予約」になる
   * （一覧クエリが publishedAt <= now を条件にしているため、時刻が来るまで出ない）。
   * 未指定の場合はエンコード完了時に現在時刻が入る（= 完了しだい公開）。
   */
  publishedAt: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime().optional(),
});
export type CreateVideoInput = z.infer<typeof CreateVideoSchema>;

// コメント投稿 (STANDARD 以上限定)
export const CreateContentCommentSchema = z.object({
  contentId: z.uuid(),
  body: z.string().min(1, '本文を入力してください').max(2000, '2000文字以内で入力してください'),
});
export type CreateContentCommentInput = z.infer<typeof CreateContentCommentSchema>;

export const ListContentCommentsQuerySchema = z.object({
  contentId: z.uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListContentCommentsQuery = z.infer<typeof ListContentCommentsQuerySchema>;
