import { z } from 'zod';

export const SignUpSchema = z.object({
  email: z.email(),
  password: z
    .string()
    .min(8, 'パスワードは8文字以上で入力してください')
    .regex(/[A-Z]/, '大文字を含めてください')
    .regex(/[a-z]/, '小文字を含めてください')
    .regex(/[0-9]/, '数字を含めてください'),
  // ニックネーム (表示名) — 必須
  displayName: z
    .string({ error: 'ニックネーム (表示名) を入力してください' })
    .min(1, 'ニックネーム (表示名) を入力してください')
    .max(50, 'ニックネームは50文字以内で入力してください'),
  // 氏名 — 必須
  fullName: z
    .string({ error: 'お名前を入力してください' })
    .min(1, 'お名前を入力してください')
    .max(100, 'お名前は100文字以内で入力してください'),
  // 電話番号 — 必須
  phone: z
    .string({ error: '電話番号を入力してください' })
    .min(1, '電話番号を入力してください')
    .regex(/^[0-9\-+()\s]+$/, '電話番号の形式が正しくありません')
    .max(20, '電話番号は20文字以内で入力してください'),
  // 生年月日 — 必須 (YYYY-MM-DD)
  birthDate: z.iso.date('生年月日を入力してください'),
  // 住所 — 必須 (郵便番号 / 都道府県 / 市区町村・番地)
  postalCode: z
    .string({ error: '郵便番号を入力してください' })
    .regex(/^\d{3}-?\d{4}$/, '郵便番号は7桁で入力してください'),
  prefecture: z
    .string({ error: '都道府県を選択してください' })
    .min(1, '都道府県を選択してください')
    .max(20),
  addressLine1: z
    .string({ error: '住所 (市区町村・番地) を入力してください' })
    .min(1, '住所 (市区町村・番地) を入力してください')
    .max(200, '住所は200文字以内で入力してください'),
  // 建物名・部屋番号 — 任意
  addressLine2: z.string().max(200).optional(),
  marketingOptIn: z.boolean().optional().default(false),
});
export type SignUpInput = z.infer<typeof SignUpSchema>;

export const SignInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type SignInInput = z.infer<typeof SignInSchema>;

// メール認証コード (6桁数字) の入力検証
export const VerifyEmailCodeSchema = z.object({
  email: z.email(),
  code: z
    .string({ error: '認証コードを入力してください' })
    .regex(/^\d{6}$/, '認証コードは6桁の数字で入力してください'),
});
export type VerifyEmailCodeInput = z.infer<typeof VerifyEmailCodeSchema>;

// 認証コードの再送依頼
export const ResendVerificationCodeSchema = z.object({
  email: z.email(),
});
export type ResendVerificationCodeInput = z.infer<typeof ResendVerificationCodeSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.email(),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  fullName: z.string().min(1).max(100).optional(),
  furigana: z.string().max(100).optional(),
  phone: z
    .string()
    .regex(/^[0-9\-+()]+$/, '電話番号の形式が正しくありません')
    .optional(),
  birthDate: z.iso.date().optional(),
  postalCode: z
    .string()
    .regex(/^\d{3}-?\d{4}$/, '郵便番号は7桁で入力してください')
    .optional(),
  prefecture: z.string().max(20).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  marketingOptIn: z.boolean().optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

// 退会 (自己アカウント削除) — 誤操作防止のためパスワード再入力を必須にする
export const WithdrawAccountSchema = z.object({
  password: z.string().min(1, 'パスワードを入力してください'),
});
export type WithdrawAccountInput = z.infer<typeof WithdrawAccountSchema>;
