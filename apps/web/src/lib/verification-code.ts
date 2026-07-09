/**
 * メール認証コード (新規登録時) の生成・設定値
 *
 * - 6桁の数字コード (先頭ゼロ埋め)
 * - 有効期限: 発行から VERIFICATION_CODE_TTL_MINUTES 分
 * - 連続で MAX_VERIFICATION_ATTEMPTS 回間違えたら再送を要求する
 * - 再送はクールダウン (RESEND_COOLDOWN_SECONDS) を設けて連打を防ぐ
 */
import { randomInt } from 'node:crypto';

export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_CODE_TTL_MINUTES = 15;
export const MAX_VERIFICATION_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;

/** 6桁の数字コード ("000000" 〜 "999999") を生成する */
export function generateVerificationCode(): string {
  const max = 10 ** VERIFICATION_CODE_LENGTH;
  return String(randomInt(0, max)).padStart(VERIFICATION_CODE_LENGTH, '0');
}

export function verificationCodeExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);
}
