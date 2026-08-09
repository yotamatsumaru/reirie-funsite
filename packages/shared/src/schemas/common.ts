import { z } from 'zod';

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function paginated<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    hasMore: z.boolean(),
  });
}

/**
 * 郵便番号の入力検証 (共通)。
 *
 * 【なぜ transform を挟むのか】
 * 携帯 (docomo 等) の日本語キーボードでは全角数字「１５７００６６」で入力されがちで、
 * 素の `/^\d{3}-?\d{4}$/` は全角にマッチしないため
 * 「郵便番号は7桁で入力してください」で会員登録が弾かれてしまう。
 * NFKC 正規化 + 数字以外の除去を先に行い、最終的に 123-4567 形式へ揃えて保存する。
 *
 * 〒記号・全角ハイフン・スペース付きの入力も受け付ける。
 */
export const PostalCodeSchema = z
  .string({ error: '郵便番号を入力してください' })
  .transform((v) => (v ?? '').normalize('NFKC').replace(/[^0-9]/g, ''))
  .refine((digits) => digits.length === 7, {
    message: '郵便番号は7桁で入力してください',
  })
  .transform((digits) => `${digits.slice(0, 3)}-${digits.slice(3)}`);

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
