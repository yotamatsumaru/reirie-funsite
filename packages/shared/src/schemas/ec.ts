import { z } from 'zod';
import { PostalCodeSchema } from './common';

export const ListProductsQuerySchema = z.object({
  category: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListProductsQuery = z.infer<typeof ListProductsQuerySchema>;

/** 商品オプションの入力 (optionId → 入力文字列)。未入力は省略可。 */
export const OptionInputsSchema = z.record(z.uuid(), z.string().max(500)).optional();

export const AddToCartSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(99),
  // 宛名付きチェキ等の「商品オプション」入力値。商品にオプションが定義されている場合、
  // 必須項目が欠けているとサーバー側で 400 を返す。
  options: OptionInputsSchema,
});
export type AddToCartInput = z.infer<typeof AddToCartSchema>;

export const UpdateCartItemSchema = z.object({
  quantity: z.number().int().min(0).max(99),
});
export type UpdateCartItemInput = z.infer<typeof UpdateCartItemSchema>;

export const ShippingAddressSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(1).max(20),
  postalCode: PostalCodeSchema,
  prefecture: z.string().min(1).max(20),
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional(),
});
export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;

export const CheckoutSchema = z.object({
  shipping: ShippingAddressSchema,
  /** 購入者が選んだ配送方法。未指定なら候補の先頭 (最安) を採用する。 */
  shippingMethodId: z.uuid().optional(),
  notes: z.string().max(500).optional(),
  successUrl: z.url(),
  cancelUrl: z.url(),
});
export type CheckoutInput = z.infer<typeof CheckoutSchema>;

export const CreateProductSchema = z.object({
  // slug はサーバー側で商品名から自動生成するため任意。
  // 渡された場合のみ形式チェックを行う（後方互換）。
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  basePrice: z.number().int().min(0),
  memberPrice: z.number().int().min(0).optional(),
  premiumPrice: z.number().int().min(0).optional(),
  categoryId: z.uuid().optional(),
  isActive: z.boolean().default(true),
  isMembersOnly: z.boolean().default(false),
  isPremiumExclusive: z.boolean().default(false),
  // ---- 販売期間 (null = 制限なし) ----
  saleStartsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  saleEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  // ---- 配送方法の割り当て (省略 = 変更しない / [] = 全解除 → 基本配送に戻る) ----
  shippingMethodIds: z.array(z.uuid()).max(50).optional(),
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

/** 複数商品の販売期間を一括設定する (一斉発売用) */
export const BulkSalePeriodSchema = z.object({
  productIds: z.array(z.uuid()).min(1).max(200),
  saleStartsAt: z.iso.datetime({ offset: true }).nullable(),
  saleEndsAt: z.iso.datetime({ offset: true }).nullable(),
  /** true なら同時に isActive=true にする (非公開のまま予約したい場合は false) */
  activate: z.boolean().default(true),
});
export type BulkSalePeriodInput = z.infer<typeof BulkSalePeriodSchema>;

// ---- 配送方法 (管理) ----
export const ShippingMethodInputSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(200).nullable().optional(),
  fee: z.number().int().min(0).max(100000),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  b2InvoiceType: z.string().max(4).nullable().optional(),
});
export type ShippingMethodInput = z.infer<typeof ShippingMethodInputSchema>;

// ---- 商品オプション (管理) ----
export const ProductOptionInputSchema = z.object({
  name: z.string().min(1).max(60),
  helpText: z.string().max(300).nullable().optional(),
  maxLength: z.number().int().min(1).max(500).default(20),
  price: z.number().int().min(0).max(100000).default(0),
  isRequired: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type ProductOptionInput = z.infer<typeof ProductOptionInputSchema>;

export const UpdateInventorySchema = z.object({
  quantity: z.number().int().min(0),
  safetyStock: z.number().int().min(0).optional(),
});
export type UpdateInventoryInput = z.infer<typeof UpdateInventorySchema>;
