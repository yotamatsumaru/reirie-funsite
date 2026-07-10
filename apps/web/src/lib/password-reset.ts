/**
 * パスワードリセット (forgot-password) の設定値
 *
 * - トークン有効期限: 発行から PASSWORD_RESET_TTL_MINUTES 分
 * - 再送はクールダウン (PASSWORD_RESET_RESEND_COOLDOWN_SECONDS) を設けて連打を防ぐ
 *   (resend-verification-code と同様、発行済みトークンの有効期限から逆算する方式)
 */

export const PASSWORD_RESET_TTL_MINUTES = 60;
export const PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = 60;

export function passwordResetExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
}
