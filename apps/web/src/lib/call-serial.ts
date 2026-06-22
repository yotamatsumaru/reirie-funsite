/**
 * CD 封入用シリアルコードの生成ユーティリティ。
 *
 * - 形式: "XXXX-XXXX-XXXX" (12 文字 + ハイフン区切り 2 つ)
 * - 文字種: 大文字英数字。視認性が悪い文字 (0/O, 1/I/L) は除外。
 *   これにより CD 封入の紙面で手入力したファンの誤入力を減らす。
 * - 衝突確率: 文字種 32, 12 文字なので 32^12 ≒ 1.15×10^18 通り。
 *   200 枚程度のイベントでは事実上衝突しない。
 * - 万一衝突した場合は呼び出し側 (Prisma の unique 制約) で弾かれるため、
 *   ループでリトライする運用に組み込みやすい。
 */
import { randomInt } from 'node:crypto';

// 0/O/1/I/L を除外したカスタムアルファベット (32 文字)
const SERIAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomChunk(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += SERIAL_ALPHABET[randomInt(0, SERIAL_ALPHABET.length)];
  }
  return s;
}

/**
 * 1 つのシリアルコードを生成する。
 * 戻り値はハイフン区切りの表示用 (CSV / 紙面用) コード。
 * DB に保存する際は正規化 (ハイフン除去) されたものを使う。
 */
export function generateSerialCodeDisplay(): string {
  return `${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}`;
}

/**
 * 表示用コードを DB 保存用に正規化する (ハイフン除去 + 大文字化)。
 * normalizeSerialCode (shared) と同一の結果を返す。
 */
export function toCanonicalSerialCode(display: string): string {
  return display.replace(/[\s\-_]+/g, '').toUpperCase();
}
