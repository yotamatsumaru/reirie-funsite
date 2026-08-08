import { z } from 'zod';
import { PostalCodeSchema } from './common';

export const ListProductsQuerySchema = z.object({
  category: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListProductsQuery = z.infer<typeof ListProductsQuerySchema>;

export const AddToCartSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(99),
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
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const UpdateInventorySchema = z.object({
  quantity: z.number().int().min(0),
  safetyStock: z.number().int().min(0).optional(),
});
export type UpdateInventoryInput = z.infer<typeof UpdateInventorySchema>;
