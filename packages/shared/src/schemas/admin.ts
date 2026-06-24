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

// =====================================================================
// Admin Invitation (管理者メール招待)
// =====================================================================

/** 管理者として付与するロール (USER は付与対象外) */
export const InvitableRoleSchema = z.enum(['ADMIN', 'SUPER_ADMIN']);
export type InvitableRole = z.infer<typeof InvitableRoleSchema>;

export const AdminInvitationStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'REVOKED',
  'EXPIRED',
]);
export type AdminInvitationStatusLiteral = z.infer<typeof AdminInvitationStatusSchema>;

export const ADMIN_INVITATION_STATUS_LABELS: Record<AdminInvitationStatusLiteral, string> = {
  PENDING: '招待中',
  ACCEPTED: '受諾済み',
  REVOKED: '取消済み',
  EXPIRED: '期限切れ',
};

/** 招待の有効期限（日数） */
export const ADMIN_INVITATION_EXPIRY_DAYS = 7;

/** スーパー管理者が管理者を招待する */
export const CreateAdminInvitationSchema = z.object({
  email: z.email(),
  role: InvitableRoleSchema.default('ADMIN'),
  note: z.string().max(500).optional(),
});
export type CreateAdminInvitationInput = z.infer<typeof CreateAdminInvitationSchema>;

/**
 * 招待受諾。
 *  - 既存ユーザー: ログイン状態で受諾（追加情報不要）→ password 省略可
 *  - 新規ユーザー: アカウント作成のため displayName / password が必須
 *
 * サーバー側で「既存か新規か」を判定し、新規時に password 必須チェックを行う。
 */
export const AcceptAdminInvitationSchema = z.object({
  token: z.string().min(10),
  // 新規アカウント作成時のみ使用
  displayName: z.string().min(1).max(50).optional(),
  password: z.string().min(8).max(100).optional(),
});
export type AcceptAdminInvitationInput = z.infer<typeof AcceptAdminInvitationSchema>;
