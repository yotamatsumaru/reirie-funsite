/**
 * 管理画面 (Admin) で使う追加スキーマ
 */
import { z } from 'zod';

// ---- Product Variant ----
export const CreateProductVariantSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  optionColor: z.string().max(40).optional(),
  optionSize: z.string().max(40).optional(),
  priceDelta: z.number().int().default(0),
  weightGrams: z.number().int().min(0).optional(),
  isActive: z.boolean().default(true),
  initialQuantity: z.number().int().min(0).default(0),
  safetyStock: z.number().int().min(0).default(0),
});
export type CreateProductVariantInput = z.infer<typeof CreateProductVariantSchema>;

// ---- Category ----
export const CreateCategorySchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  parentId: z.uuid().optional(),
  sortOrder: z.number().int().min(0).default(0),
});
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

// ---- Video upload presign ----
export const PresignVideoUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
});
export type PresignVideoUploadInput = z.infer<typeof PresignVideoUploadSchema>;

// ---- Order shipping ----
export const ShipOrderSchema = z.object({
  trackingNumber: z.string().min(1).max(80),
  carrier: z.string().max(40).optional(),
  notifyCustomer: z.boolean().default(true),
});
export type ShipOrderInput = z.infer<typeof ShipOrderSchema>;

// ---- Admin orders list ----
export const AdminListOrdersQuerySchema = z.object({
  status: z
    .enum(['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELED', 'REFUNDED'])
    .optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AdminListOrdersQuery = z.infer<typeof AdminListOrdersQuerySchema>;

// ---- Live (admin) ----
export const UpdateLiveStreamSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  thumbnailUrl: z.url().optional(),
  isPrivate: z.boolean().optional(),
  accessLevel: z.enum(['PUBLIC', 'MEMBERS', 'PREMIUM']).optional(),
  status: z.enum(['SCHEDULED', 'LIVE', 'ENDED', 'CANCELED']).optional(),
  scheduledStartAt: z.iso.datetime().optional(),
  ivsChannelArn: z.string().optional(),
  ivsPlaybackUrl: z.url().optional(),
});
export type UpdateLiveStreamInput = z.infer<typeof UpdateLiveStreamSchema>;

// ---- Admin contents query ----
export const AdminListContentsQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  type: z.enum(['BLOG', 'GALLERY']).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AdminListContentsQuery = z.infer<typeof AdminListContentsQuerySchema>;
