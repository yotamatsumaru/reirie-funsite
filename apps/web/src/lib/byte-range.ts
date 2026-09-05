/**
 * HTTP Range ヘッダ (`bytes=START-END`) の解釈。
 *
 * 動画配信 (/api/media/content-body-video/[id]) で 206 Partial Content を
 * 返すために使う。route.ts に直接書かず切り出しているのは、
 * jest の testMatch が `.ts` のみで、かつ Route Handler は
 * next/server に依存してテストしづらいため。
 *
 * ここが正しく動かないと iOS Safari で動画が再生できない
 * (Safari は必ず Range を送り、206 が返らないと再生を諦める) ので、
 * 境界値を含めてテストで固めておく価値がある。
 */
export type ByteRange = { start: number; end: number };

/**
 * Range ヘッダを解釈する。
 *
 * @returns 解釈できた範囲。未指定・不正・複数レンジは null (呼び出し側は全体を返す)。
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange | null {
  if (!header) return null;
  if (!Number.isFinite(size) || size <= 0) return null;

  // multipart range (bytes=0-99,200-299) は使わないので単一レンジのみ扱う。
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;

  const startRaw = m[1]!;
  const endRaw = m[2]!;

  // `bytes=-500` = 末尾 500 バイト
  if (startRaw === '') {
    if (endRaw === '') return null;
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0 || start >= size) return null;

  // `bytes=100-` = 100 バイト目から末尾まで
  const end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (!Number.isFinite(end) || end < start) return null;

  return { start, end };
}
