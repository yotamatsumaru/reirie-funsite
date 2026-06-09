import { z } from 'zod';

export const SignUpSchema = z.object({
  email: z.email(),
  password: z
    .string()
    .min(8, 'パスワードは8文字以上で入力してください')
    .regex(/[A-Z]/, '大文字を含めてください')
    .regex(/[a-z]/, '小文字を含めてください')
    .regex(/[0-9]/, '数字を含めてください'),
  displayName: z.string().min(1).max(50),
  marketingOptIn: z.boolean().optional().default(false),
});
export type SignUpInput = z.infer<typeof SignUpSchema>;

export const SignInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type SignInInput = z.infer<typeof SignInSchema>;

export const VerifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

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
