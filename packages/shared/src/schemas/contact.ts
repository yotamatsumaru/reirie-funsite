import { z } from 'zod';

/**
 * お問い合わせフォーム関連のスキーマ・定数。
 * - 公開フォーム (/contact) からの送信バリデーションに使用。
 * - 管理画面 (/super-admin/contact) のステータス更新にも使用。
 */

/** お問い合わせ種別 (Prisma enum ContactCategory と一致させる) */
export const CONTACT_CATEGORIES = [
  'GENERAL',
  'ACCOUNT',
  'BILLING',
  'SHIPPING',
  'BUG',
  'OTHER',
] as const;
export type ContactCategoryLiteral = (typeof CONTACT_CATEGORIES)[number];

export const CONTACT_CATEGORY_LABELS: Record<ContactCategoryLiteral, string> = {
  GENERAL: '一般的なお問い合わせ',
  ACCOUNT: 'アカウント・ログイン',
  BILLING: 'お支払い・会員プラン',
  SHIPPING: '配送・グッズ',
  BUG: '不具合の報告',
  OTHER: 'その他',
};

/** お問い合わせ対応状況 (Prisma enum ContactStatus と一致させる) */
export const CONTACT_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type ContactStatusLiteral = (typeof CONTACT_STATUSES)[number];

export const CONTACT_STATUS_LABELS: Record<ContactStatusLiteral, string> = {
  NEW: '新規',
  IN_PROGRESS: '対応中',
  RESOLVED: '対応済み',
  CLOSED: 'クローズ',
};

export const CONTACT_SUBJECT_MAX = 120;
export const CONTACT_MESSAGE_MAX = 4000;
export const CONTACT_MESSAGE_MIN = 10;

/** 公開フォームからの送信スキーマ */
export const ContactSubmitSchema = z.object({
  name: z
    .string({ error: 'お名前を入力してください' })
    .trim()
    .min(1, 'お名前を入力してください')
    .max(100, 'お名前は100文字以内で入力してください'),
  email: z.email('メールアドレスの形式が正しくありません').max(254),
  category: z.enum(CONTACT_CATEGORIES).default('GENERAL'),
  subject: z
    .string({ error: '件名を入力してください' })
    .trim()
    .min(1, '件名を入力してください')
    .max(CONTACT_SUBJECT_MAX, `件名は${CONTACT_SUBJECT_MAX}文字以内で入力してください`),
  message: z
    .string({ error: 'お問い合わせ内容を入力してください' })
    .trim()
    .min(CONTACT_MESSAGE_MIN, `お問い合わせ内容は${CONTACT_MESSAGE_MIN}文字以上で入力してください`)
    .max(CONTACT_MESSAGE_MAX, `お問い合わせ内容は${CONTACT_MESSAGE_MAX}文字以内で入力してください`),
});
export type ContactSubmitInput = z.infer<typeof ContactSubmitSchema>;

export const CONTACT_REPLY_MAX = 4000;
export const CONTACT_REPLY_MIN = 1;

/** 管理画面: お問い合わせへの返信送信スキーマ */
export const ContactReplySchema = z.object({
  body: z
    .string({ error: '返信内容を入力してください' })
    .trim()
    .min(CONTACT_REPLY_MIN, '返信内容を入力してください')
    .max(CONTACT_REPLY_MAX, `返信内容は${CONTACT_REPLY_MAX}文字以内で入力してください`),
  /**
   * 返信後に対応状況を「対応済み(RESOLVED)」へ自動更新するか。
   * 既定 true (返信＝対応完了とみなす)。false にすれば状況は変更しない。
   */
  markResolved: z.boolean().default(true),
});
export type ContactReplyInput = z.infer<typeof ContactReplySchema>;

/** 管理画面: 対応状況・管理メモ更新スキーマ */
export const ContactUpdateSchema = z.object({
  status: z.enum(CONTACT_STATUSES).optional(),
  adminNote: z
    .string()
    .trim()
    .max(4000, '管理メモは4000文字以内で入力してください')
    .optional(),
});
export type ContactUpdateInput = z.infer<typeof ContactUpdateSchema>;
