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
  imageUrls: z.array(z.url()).optional(),
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
