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

/**
 * テスト送信リクエストのスキーマ。
 *  - 指定年のテンプレートを、任意のメールアドレスへ 1 通だけ送る (配信記録は残さない)。
 *  - name は差し込み変数 {name} の確認用 (省略可)。
 */
export const BirthdayMailTestSendSchema = z.object({
  year: z
    .number()
    .int()
    .min(BIRTHDAY_MAIL_YEAR_MIN)
    .max(BIRTHDAY_MAIL_YEAR_MAX),
  to: z
    .string({ error: 'メールアドレスを入力してください' })
    .trim()
    .min(1, 'メールアドレスを入力してください')
    .email('メールアドレスの形式が正しくありません'),
  name: z.string().trim().max(60, '名前は60文字以内で入力してください').optional(),
});
export type BirthdayMailTestSendInput = z.infer<typeof BirthdayMailTestSendSchema>;

/** 差し込み変数を実際の値に置換する (件名・本文で共通利用) */
export function renderBirthdayMailText(
  template: string,
  vars: { name: string; year: number },
): string {
  return template
    .replace(/\{name\}/g, vars.name)
    .replace(/\{year\}/g, String(vars.year));
}

// ===========================================================================
// 自動送信スケジュール
// ===========================================================================

/**
 * 誕生日メールの自動送信スケジュール設定を保存する AppSetting のキー。
 * value は BirthdayMailScheduleSchema に沿った JSON。
 */
export const BIRTHDAY_MAIL_SCHEDULE_KEY = 'birthdayMail.schedule';

/**
 * 自動送信の実行状況 (「今日はもう走ったか」) を保存する AppSetting のキー。
 *
 * 【なぜ必要か】本番は PM2 cluster (複数プロセス) で動いており、OS cron から
 * localhost を叩くと どれか 1 プロセスが処理する。cron が数分おきに走る構成では
 * 「12:00 を過ぎている」条件だけでは 1 日に何度も一斉送信が走ってしまう。
 * そこで「その日ぶんを予約 (claim) した日付」を DB に記録し、
 * 1 日 1 回だけ実行されるようにする。
 */
export const BIRTHDAY_MAIL_RUN_STATE_KEY = 'birthdayMail.runState';

/**
 * 既定のスケジュール。
 * 【要件】既定の送信時刻は「お昼の 12:00 (JST)」。
 */
export const DEFAULT_BIRTHDAY_MAIL_SCHEDULE = {
  enabled: true,
  hour: 12,
  minute: 0,
} as const;

/** 管理画面の「分」セレクタの刻み (OS cron の実行間隔と揃えている)。 */
export const BIRTHDAY_MAIL_MINUTE_STEP = 5;

/**
 * 自動送信スケジュール。
 *  - enabled: 自動送信そのもののオン/オフ。
 *  - hour / minute: 送信時刻 (JST)。この時刻を過ぎた最初の cron 実行で送信される。
 */
export const BirthdayMailScheduleSchema = z.object({
  enabled: z.boolean().default(DEFAULT_BIRTHDAY_MAIL_SCHEDULE.enabled),
  hour: z
    .number({ error: '時 (0〜23) を入力してください' })
    .int('時は整数で入力してください')
    .min(0, '時は 0〜23 で入力してください')
    .max(23, '時は 0〜23 で入力してください')
    .default(DEFAULT_BIRTHDAY_MAIL_SCHEDULE.hour),
  minute: z
    .number({ error: '分 (0〜59) を入力してください' })
    .int('分は整数で入力してください')
    .min(0, '分は 0〜59 で入力してください')
    .max(59, '分は 0〜59 で入力してください')
    .default(DEFAULT_BIRTHDAY_MAIL_SCHEDULE.minute),
});
export type BirthdayMailSchedule = z.infer<typeof BirthdayMailScheduleSchema>;

/** 管理画面からの部分更新 (変更されたフィールドのみ送る) 用。 */
export const BirthdayMailScheduleUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    hour: z.number().int().min(0, '時は 0〜23 で入力してください').max(23, '時は 0〜23 で入力してください').optional(),
    minute: z.number().int().min(0, '分は 0〜59 で入力してください').max(59, '分は 0〜59 で入力してください').optional(),
  })
  .refine((v) => v.enabled !== undefined || v.hour !== undefined || v.minute !== undefined, {
    message: '変更する項目がありません',
  });
export type BirthdayMailScheduleUpdate = z.infer<typeof BirthdayMailScheduleUpdateSchema>;

/** 自動送信の実行状況 (最後にいつ走って、どうだったか)。 */
export const BirthdayMailRunStateSchema = z.object({
  /** その日ぶんの送信を予約/実行した JST 日付 ('YYYY-MM-DD')。未実行なら null。 */
  lastRunDate: z.string().nullable().default(null),
  /** 最後に実行した時刻 (ISO 文字列)。 */
  lastRunAt: z.string().nullable().default(null),
  /** 最後の実行結果の種別 (AutoSendStatus の文字列)。 */
  lastStatus: z.string().nullable().default(null),
  /** 最後の実行で送信できた件数。 */
  lastSent: z.number().int().nullable().default(null),
  /** 最後の実行で失敗した件数。 */
  lastFailed: z.number().int().nullable().default(null),
});
export type BirthdayMailRunState = z.infer<typeof BirthdayMailRunStateSchema>;

export const DEFAULT_BIRTHDAY_MAIL_RUN_STATE: BirthdayMailRunState = {
  lastRunDate: null,
  lastRunAt: null,
  lastStatus: null,
  lastSent: null,
  lastFailed: null,
};

/** 時刻を 'HH:MM' 表記にする (管理画面 / ログ表示用)。 */
export function formatBirthdayMailTime(time: { hour: number; minute: number }): string {
  const hh = String(time.hour).padStart(2, '0');
  const mm = String(time.minute).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 時刻を「その日の 0:00 からの経過分」に変換する (比較用)。 */
export function birthdayMailTimeToMinutes(time: { hour: number; minute: number }): number {
  return time.hour * 60 + time.minute;
}

/**
 * 「いま送信すべき時刻を過ぎているか」を判定する純関数 (JST の時刻を渡すこと)。
 *
 * 【なぜ「一致」ではなく「以上」なのか】
 *  OS cron は数分おきに叩く方式なので、12:00 ちょうどに実行される保証がない
 *  (デプロイ中・再起動中に 12:00 を跨ぐこともある)。「12:00 以降なら送る」に
 *  しておけば、多少遅れても その日のうちに必ず届く。二重送信は
 *  BIRTHDAY_MAIL_RUN_STATE_KEY の日付 claim と
 *  BirthdayMailDelivery の userId+year ユニーク制約で防いでいる。
 */
export function isBirthdayMailScheduleDue(
  schedule: { hour: number; minute: number },
  now: { hour: number; minute: number },
): boolean {
  return birthdayMailTimeToMinutes(now) >= birthdayMailTimeToMinutes(schedule);
}

/** 'YYYY-MM-DD' 形式の JST 日付文字列を作る (実行状況の記録キー)。 */
export function formatBirthdayMailDate(date: { year: number; month: number; day: number }): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}-${mm}-${dd}`;
}
