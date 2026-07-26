import { z } from 'zod';

/**
 * 誕生日メール機能のスキーマ・定数。
 *
 * - 年ごとのテンプレート (2026 版など) の作成・更新バリデーション。
 * - 管理画面 (/super-admin/birthday) からのテンプレート保存・送信操作に使用。
 * - 本文・件名では差し込み変数 {name} が使える (会員の呼び名に置換される)。
 */

export const BIRTHDAY_MAIL_SUBJECT_MAX = 120;
export const BIRTHDAY_MAIL_BODY_MAX = 4000;
export const BIRTHDAY_MAIL_BODY_MIN = 1;

/** テンプレートで扱える年の範囲 (誤入力防止のゆるいガード) */
export const BIRTHDAY_MAIL_YEAR_MIN = 2020;
export const BIRTHDAY_MAIL_YEAR_MAX = 2100;

/** 差し込み変数の一覧 (UI のヘルプ表示用) */
export const BIRTHDAY_MAIL_PLACEHOLDERS = [
  { token: '{name}', description: '会員の呼び名 (呼んでほしい名前 / 表示名 / お名前)' },
  { token: '{year}', description: '対象年 (西暦)' },
] as const;

/** 既定の件名 (新規作成時のたたき台) */
export const DEFAULT_BIRTHDAY_MAIL_SUBJECT = '{name}さん、お誕生日おめでとうございます！🎂';

/** 既定の本文 (新規作成時のたたき台) */
export const DEFAULT_BIRTHDAY_MAIL_BODY = `{name}さん

お誕生日おめでとうございます！🎉

いつも ReiRieRoom を応援してくださり、本当にありがとうございます。
{name}さんにとって、素敵な一年になりますように。

これからも一緒に楽しい時間を過ごしていきましょう！

― REIRIE より`;

/** テンプレートの新規作成 / 更新スキーマ (画像は別リクエストでアップロード) */
export const BirthdayMailTemplateSchema = z.object({
  year: z
    .number({ error: '年を入力してください' })
    .int('年は整数で入力してください')
    .min(BIRTHDAY_MAIL_YEAR_MIN, `年は${BIRTHDAY_MAIL_YEAR_MIN}以降で入力してください`)
    .max(BIRTHDAY_MAIL_YEAR_MAX, `年は${BIRTHDAY_MAIL_YEAR_MAX}以前で入力してください`),
  subject: z
    .string({ error: '件名を入力してください' })
    .trim()
    .min(1, '件名を入力してください')
    .max(BIRTHDAY_MAIL_SUBJECT_MAX, `件名は${BIRTHDAY_MAIL_SUBJECT_MAX}文字以内で入力してください`),
  body: z
    .string({ error: '本文を入力してください' })
    .trim()
    .min(BIRTHDAY_MAIL_BODY_MIN, '本文を入力してください')
    .max(BIRTHDAY_MAIL_BODY_MAX, `本文は${BIRTHDAY_MAIL_BODY_MAX}文字以内で入力してください`),
  enabled: z.boolean().default(true),
});
export type BirthdayMailTemplateInput = z.infer<typeof BirthdayMailTemplateSchema>;

/** 送信リクエストのスキーマ (userIds を指定して送る / 空なら「今日の未送信全員」) */
export const BirthdayMailSendSchema = z.object({
  year: z
    .number()
    .int()
    .min(BIRTHDAY_MAIL_YEAR_MIN)
    .max(BIRTHDAY_MAIL_YEAR_MAX),
  /**
   * 送信対象の userId 配列。
   *  - 指定あり: その会員だけに送る (個別送信)。
   *  - 省略 / 空配列: 「今日が誕生日で、その年に未送信」の会員全員に一斉送信。
   */
  userIds: z.array(z.uuid()).optional(),
});
export type BirthdayMailSendInput = z.infer<typeof BirthdayMailSendSchema>;

/** 差し込み変数を実際の値に置換する (件名・本文で共通利用) */
export function renderBirthdayMailText(
  template: string,
  vars: { name: string; year: number },
): string {
  return template
    .replace(/\{name\}/g, vars.name)
    .replace(/\{year\}/g, String(vars.year));
}
