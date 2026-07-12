/**
 * TOTP (Time-based One-Time Password) 2段階認証ユーティリティ
 *
 * - Google Authenticator / Microsoft Authenticator 等の認証アプリと互換 (RFC 4226 / RFC 6238)
 * - SUPER_ADMIN 限定機能 (auth.ts の Credentials Provider から利用)
 * - 外部の otplib は ESM-only の依存チェーン (@scure/base 等) を持ち、本リポジトリの
 *   Jest (ts-jest / CommonJS) 環境と相性が悪かったため、Node.js 標準の `crypto` のみで
 *   RFC 6238 を直接実装している (依存を増やさず、テストも安定して動く)。
 * - シークレットは平文で DB に保存しない。AES-256-GCM で暗号化して保存する
 *   (鍵は env.totp.encryptionKey を scrypt で 32byte に正規化したもの)。
 * - バックアップコード (リカバリコード) は scrypt ハッシュで保存し、
 *   使用時に平文入力からハッシュを再計算して配列から突合する。
 */
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHmac,
} from 'node:crypto';
import QRCode from 'qrcode';
import { env } from './env';

const APP_ISSUER = 'REIRIE Fan Site';
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM 推奨IV長
const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_LENGTH = 10; // 英数字10桁 (ハイフン無し)

// RFC 6238 標準パラメータ (Google Authenticator 互換)
const TOTP_PERIOD_SEC = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = 'sha1';
// 前後何ステップ (±30秒 x N) までの時刻ズレを許容するか
const TOTP_WINDOW_STEPS = 1;

// ===========================================================================
// Base32 (RFC 4648) — otplib/authenticator 系ツールと同じアルファベットを使用
// ===========================================================================
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.trim().toUpperCase().replace(/=+$/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue; // 想定外の文字は無視 (認証アプリが表示するコピー時の空白等に耐性を持たせる)
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ===========================================================================
// RFC 6238 TOTP コア実装
// ===========================================================================

/** counter (8byte big-endian) に対する HOTP (RFC 4226) を計算する */
function hotp(secretBytes: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(TOTP_ALGORITHM, secretBytes).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** TOTP_DIGITS;
  return String(binCode % mod).padStart(TOTP_DIGITS, '0');
}

function totpCounter(epochSec: number): number {
  return Math.floor(epochSec / TOTP_PERIOD_SEC);
}

/** 指定 Base32 シークレットから現在時刻のTOTPコードを生成する */
export function generateTotpCode(secretBase32: string, epochSec: number = Math.floor(Date.now() / 1000)): string {
  const secretBytes = base32Decode(secretBase32);
  return hotp(secretBytes, totpCounter(epochSec));
}

/** テスト/内部検証用の別名 (auth.ts 等の呼び出し意図を明確にするためのラッパー) */
export const generateTotpTokenForTesting = generateTotpCode;

/**
 * 入力された6桁コードを検証する。
 * ±TOTP_WINDOW_STEPS ステップ (既定 ±30秒) までの時刻ズレを許容する。
 */
export function verifyTotpToken(
  secretBase32: string,
  token: string,
  epochSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const secretBytes = base32Decode(secretBase32);
  const currentCounter = totpCounter(epochSec);
  for (let delta = -TOTP_WINDOW_STEPS; delta <= TOTP_WINDOW_STEPS; delta++) {
    const candidate = hotp(secretBytes, currentCounter + delta);
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(token))) {
      return true;
    }
  }
  return false;
}

// ===========================================================================
// シークレット生成・暗号化
// ===========================================================================

/** 新規セットアップ用の Base32 シークレットを生成する (160bit = 20byte) */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** env.totp.encryptionKey から AES-256-GCM 用の鍵を導出する (固定salt。値自体が秘密なので問題ない) */
function deriveEncryptionKey(): Buffer {
  return scryptSync(env.totp.encryptionKey, 'reirie-totp-secret-v1', KEY_LEN);
}

/**
 * TOTP シークレット (Base32) を AES-256-GCM で暗号化する。
 * 保存形式: "<iv-hex>:<authTag-hex>:<ciphertext-hex>"
 */
export function encryptTotpSecret(secretBase32: string): string {
  const key = deriveEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** encryptTotpSecret() で暗号化した文字列を復号して Base32 シークレットに戻す */
export function decryptTotpSecret(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('不正な形式のTOTPシークレットです');
  }
  const [ivHex, authTagHex, cipherHex] = parts;
  const key = deriveEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

// ===========================================================================
// QRコード (otpauth:// URI)
// ===========================================================================

/** otpauth://totp/... URI を生成する (RFC "Key URI Format") */
function buildOtpAuthUri(secretBase32: string, accountEmail: string): string {
  const label = encodeURIComponent(`${APP_ISSUER}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: APP_ISSUER,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Google Authenticator 等で読み取れる QRコード (data URL) を生成する */
export async function generateTotpQrCodeDataUrl(secretBase32: string, accountEmail: string): Promise<string> {
  const uri = buildOtpAuthUri(secretBase32, accountEmail);
  return QRCode.toDataURL(uri, { margin: 1, width: 240 });
}

// ===========================================================================
// バックアップコード (リカバリコード)
// ===========================================================================

/** バックアップコード用のハッシュ (パスワードと同じ scrypt 方式。password.ts の形式と互換) */
function hashBackupCode(code: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(code, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyBackupCodeHash(code: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  try {
    const derived = scryptSync(code, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** 読みやすいバックアップコード (例: "XXXX-XXXX-XX") を1件生成する */
function generateOneBackupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O, 1/I など混同しやすい文字を除外
  let raw = '';
  const bytes = randomBytes(BACKUP_CODE_LENGTH);
  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    raw += alphabet[bytes[i] % alphabet.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

/**
 * バックアップコード一式を新規生成する。
 * 戻り値の `plain` はユーザーに一度だけ表示する平文、`hashed` は DB (totpBackupCodes) に保存する。
 */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): { plain: string[]; hashed: string[] } {
  const plain = Array.from({ length: count }, () => generateOneBackupCode());
  const hashed = plain.map(hashBackupCode);
  return { plain, hashed };
}

/**
 * 入力されたバックアップコードが保存済みハッシュ配列のいずれかに一致するか検証する。
 * 一致した場合、使用済みのハッシュを除いた新しい配列を返す (呼び出し側でDB更新すること)。
 */
export function consumeBackupCode(
  inputCode: string,
  storedHashes: string[],
): { ok: boolean; remaining: string[] } {
  const normalized = inputCode.trim().toUpperCase();
  const idx = storedHashes.findIndex((h) => verifyBackupCodeHash(normalized, h));
  if (idx === -1) return { ok: false, remaining: storedHashes };
  const remaining = [...storedHashes.slice(0, idx), ...storedHashes.slice(idx + 1)];
  return { ok: true, remaining };
}
