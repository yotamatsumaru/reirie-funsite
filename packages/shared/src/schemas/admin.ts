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

// ---- Product Image ----
export const AddProductImageSchema = z.object({
  url: z.url(),
  alt: z.string().max(160).optional(),
});
export type AddProductImageInput = z.infer<typeof AddProductImageSchema>;

/** 画像の表示順を並べ替える（id を希望の順番で渡す） */
export const ReorderProductImagesSchema = z.object({
  order: z.array(z.uuid()).min(1),
});
export type ReorderProductImagesInput = z.infer<typeof ReorderProductImagesSchema>;

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

/** 管理権限 (Admin Capability) */
export const AdminCapabilitySchema = z.enum(['CONTENT', 'MERCH', 'GAME', 'CALL']);
export type AdminCapabilityInput = z.infer<typeof AdminCapabilitySchema>;

/** スーパー管理者が管理者を招待する */
export const CreateAdminInvitationSchema = z.object({
  email: z.email(),
  role: InvitableRoleSchema.default('ADMIN'),
  // 付与する管理権限 (ADMIN のときのみ意味を持つ。SUPER_ADMIN は全権限)
  capabilities: z.array(AdminCapabilitySchema).default([]),
  note: z.string().max(500).optional(),
});
export type CreateAdminInvitationInput = z.infer<typeof CreateAdminInvitationSchema>;

/** 管理者の権限を更新する (SUPER_ADMIN 限定) */
export const UpdateAdminCapabilitiesSchema = z.object({
  capabilities: z.array(AdminCapabilitySchema),
});
export type UpdateAdminCapabilitiesInput = z.infer<typeof UpdateAdminCapabilitiesSchema>;

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

// =====================================================================
// ファンユーザーの直接登録 (Super Admin による手動登録)
// =====================================================================

/**
 * 管理画面から直接ファンユーザーを新規登録する。
 *  - 会員番号 (RR-000000 形式) を明示指定できる (通常は自動採番だが、
 *    先着特典・記念番号など運営が意図的に割り当てたい場合に使う)。
 *  - メール認証・利用規約入力を省略するため、emailVerified を即時セットする。
 *  - パスワードは省略可。省略時はサーバー側でランダム生成し、レスポンスで
 *    一度だけ返す (運営が本人へ別途安全な手段で伝える想定)。
 */
export const AdminCreateFanUserSchema = z.object({
  email: z.email(),
  displayName: z.string().min(1).max(50).optional(),
  // 会員番号 (RR-000000 形式)。未指定なら MemberCounter から自動採番する。
  memberNumber: z
    .string()
    .regex(/^RR-\d{6,}$/, '会員番号は "RR-" + 6桁以上の数字で入力してください (例: RR-000000)')
    .optional(),
  password: z.string().min(8).max(100).optional(),
});
export type AdminCreateFanUserInput = z.infer<typeof AdminCreateFanUserSchema>;

/**
 * 既存ユーザー (ファン・管理者いずれでも可) の会員番号を、メールアドレス指定で
 * 直接変更する (SUPER_ADMIN 限定)。
 *  - 記念会員番号 (RR-000000 等) を、すでにアカウントを持つ運営スタッフ本人
 *    (SUPER_ADMIN 等) に割り当てたい場合に使う。
 *  - memberNumber を null にすると会員番号を未設定に戻せる。
 */
export const AdminSetMemberNumberSchema = z.object({
  email: z.email(),
  memberNumber: z
    .string()
    .regex(/^RR-\d{6,}$/, '会員番号は "RR-" + 6桁以上の数字で入力してください (例: RR-000000)')
    .nullable(),
});
export type AdminSetMemberNumberInput = z.infer<typeof AdminSetMemberNumberSchema>;
