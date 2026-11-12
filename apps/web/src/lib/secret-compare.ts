/**
 * 秘密の値 (CRON_SECRET など) を一定時間で比較する。
 *
 * `a === b` は先頭から 1 文字ずつ比べて違った時点で終わるため、
 * 応答時間の差から正しい値を 1 文字ずつ推測される余地がある (タイミング攻撃)。
 * 長さの違いも漏らさないよう、両方を SHA-256 にかけてから timingSafeEqual で比べる。
 */
import { createHash, timingSafeEqual } from 'crypto';

function digest(v: string): Buffer {
  return createHash('sha256').update(v, 'utf8').digest();
}

/** 両方が空でない文字列で、かつ一致するときだけ true */
export function safeEqualSecret(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (provided.length === 0 || expected.length === 0) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

/** リクエストの x-cron-secret ヘッダが期待値と一致するか */
export function hasValidCronSecret(req: Request, expected: string | null | undefined): boolean {
  return safeEqualSecret(req.headers.get('x-cron-secret'), expected);
}
