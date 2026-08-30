import { z } from 'zod';

/**
 * 登録メールアドレスの変更フロー用スキーマ・ユーティリティ
 *
 * 【なぜ「ただ更新するだけ」ではいけないのか】
 * このサイトではメールアドレスが **ログイン ID そのもの** であり、かつ
 * パスワードリセットの送信先でもある。つまりメールアドレスを書き換える行為は
 * 「アカウントの所有者を変更する」のとほぼ同じ重みを持つ。
 * そのため、以下の 3 つを必ず満たす設計にしている。
 *
 *  1. 本人確認 (パスワード再入力)
 *     セッションを乗っ取られただけでアカウントを奪われないようにする。
 *
 *  2. 新アドレスの所有証明 (確認コード)
 *     打ち間違いのまま確定すると、本人が二度とログインできなくなる
 *     (ログイン ID が届かないアドレスになるため復旧不能)。
 *     新アドレス宛に届いたコードを入力できて初めて確定する。
 *
 *  3. 旧アドレスへの通知
 *     万一第三者に変更された場合、旧アドレスの持ち主が気づけるようにする。
 *
 * 【なぜ pending (保留) を持つのか】
 * 上記 2 のため、確認が終わるまでは新アドレスを users.email に入れられない。
 * 確定するまでの間だけ pendingEmail に退避しておき、コード入力に成功した
 * 時点で email へ昇格させる。
 */

/** 確認コードの有効期限 (分)。新規登録時のメール認証と揃えている。 */
export const EMAIL_CHANGE_CODE_TTL_MINUTES = 15;

/**
 * 確認コードの入力を何回間違えたら無効化するか。
 * 6 桁 = 100 万通りに対し総当たりを実用的でなくするための上限。
 */
export const MAX_EMAIL_CHANGE_ATTEMPTS = 5;

/** 確認コード再送のクールダウン (秒)。連打によるメール大量送信を防ぐ。 */
export const EMAIL_CHANGE_RESEND_COOLDOWN_SECONDS = 60;

/**
 * メールアドレス変更の申請。
 * password は「今ログインしている人が本人か」を確かめるためのもので、
 * パスワードを変更するわけではない。
 */
export const RequestEmailChangeSchema = z.object({
  newEmail: z.email('メールアドレスの形式が正しくありません'),
  password: z.string().min(1, '現在のパスワードを入力してください'),
});
export type RequestEmailChangeInput = z.infer<typeof RequestEmailChangeSchema>;

/** 新アドレス宛に届いた 6 桁コードの入力。 */
export const VerifyEmailChangeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, '確認コードは6桁の数字で入力してください'),
});
export type VerifyEmailChangeInput = z.infer<typeof VerifyEmailChangeSchema>;

/**
 * 比較・保存用にメールアドレスを正規化する。
 *
 * DB の email カラムは citext (大文字小文字を区別しない) なので
 * 一意性は DB 側でも守られるが、アプリ側の比較 (「今と同じアドレスか？」など) が
 * 大文字小文字でズレると「変更していないのに変更扱い」になってしまう。
 * 入口で必ずこの関数を通し、判定を DB と一致させる。
 */
export function normalizeEmailForComparison(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 2 つのメールアドレスが (大文字小文字・前後空白を無視して) 同一かどうか。
 * 「現在と同じアドレスへの変更申請」を弾くために使う。
 */
export function isSameEmail(a: string, b: string): boolean {
  return normalizeEmailForComparison(a) === normalizeEmailForComparison(b);
}

/**
 * 保留中の変更申請が「まだ有効か」を判定する。
 *
 * pendingEmail が残っていても期限切れなら無効として扱う。
 * これがないと、期限切れの申請がいつまでも画面に「変更手続き中」と
 * 表示され続け、利用者が次の申請をしてよいのか判断できなくなる。
 */
export function isEmailChangePending(params: {
  pendingEmail: string | null;
  expiresAt: Date | null;
  now?: Date;
}): boolean {
  if (!params.pendingEmail) return false;
  if (!params.expiresAt) return false;
  const now = params.now ?? new Date();
  return params.expiresAt.getTime() > now.getTime();
}

/**
 * 再送クールダウン中かどうか。
 *
 * 発行時刻そのものは保存していない (カラムを増やさないため)。
 * 有効期限から TTL を引き戻して発行時刻を復元する。
 * この方式は resend-verification-code の実装と同じ考え方で揃えてある。
 */
export function isEmailChangeResendCoolingDown(params: {
  expiresAt: Date | null;
  now?: Date;
}): boolean {
  if (!params.expiresAt) return false;
  const now = params.now ?? new Date();
  const issuedAt = params.expiresAt.getTime() - EMAIL_CHANGE_CODE_TTL_MINUTES * 60 * 1000;
  const elapsedSeconds = (now.getTime() - issuedAt) / 1000;
  return elapsedSeconds < EMAIL_CHANGE_RESEND_COOLDOWN_SECONDS;
}

/** コード入力の試行回数が上限に達したか。 */
export function hasExceededEmailChangeAttempts(attempts: number): boolean {
  return attempts >= MAX_EMAIL_CHANGE_ATTEMPTS;
}

/**
 * メールアドレスの一部を伏せて表示する (例: kayonophoo@gmail.com → k********o@gmail.com)。
 *
 * 旧アドレスへの通知メールなど「どのアドレスに変わったか」を伝えたいが、
 * 全文をそのまま載せると、通知メールが第三者に見られた場合に
 * 新アドレスまで漏れてしまう。ローカル部の先頭と末尾だけ残す。
 */
export function maskEmail(email: string): string {
  const normalized = normalizeEmailForComparison(email);
  const at = normalized.lastIndexOf('@');
  if (at <= 0) return normalized;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at);
  if (local.length <= 2) return `${local[0] ?? ''}*${domain}`;
  return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}${domain}`;
}
