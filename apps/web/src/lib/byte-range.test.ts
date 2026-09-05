import { parseByteRange } from './byte-range';

const SIZE = 1000;

describe('parseByteRange', () => {
  it('ヘッダが無ければ null (全体を返す)', () => {
    expect(parseByteRange(null, SIZE)).toBeNull();
    expect(parseByteRange(undefined, SIZE)).toBeNull();
    expect(parseByteRange('', SIZE)).toBeNull();
  });

  it('iOS Safari が最初に送る bytes=0-1 を解釈できる', () => {
    // ここが動かないと iPhone で動画が再生できない
    expect(parseByteRange('bytes=0-1', SIZE)).toEqual({ start: 0, end: 1 });
  });

  it('通常の範囲指定', () => {
    expect(parseByteRange('bytes=100-199', SIZE)).toEqual({ start: 100, end: 199 });
  });

  it('終端省略 (bytes=100-) は末尾まで', () => {
    expect(parseByteRange('bytes=100-', SIZE)).toEqual({ start: 100, end: 999 });
  });

  it('先頭省略 (bytes=-500) は末尾から N バイト', () => {
    expect(parseByteRange('bytes=-500', SIZE)).toEqual({ start: 500, end: 999 });
  });

  it('末尾指定がサイズを超える場合は先頭から', () => {
    expect(parseByteRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 });
  });

  it('終端がサイズを超える場合は末尾に丸める', () => {
    expect(parseByteRange('bytes=900-99999', SIZE)).toEqual({ start: 900, end: 999 });
  });

  it('全体指定 bytes=0- は 0..size-1', () => {
    expect(parseByteRange('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 });
  });

  it('最終バイトだけの要求', () => {
    expect(parseByteRange('bytes=999-999', SIZE)).toEqual({ start: 999, end: 999 });
  });

  it('開始がサイズ以上なら null', () => {
    expect(parseByteRange('bytes=1000-', SIZE)).toBeNull();
    expect(parseByteRange('bytes=1500-1600', SIZE)).toBeNull();
  });

  it('終端が開始より小さければ null', () => {
    expect(parseByteRange('bytes=500-100', SIZE)).toBeNull();
  });

  it('複数レンジ (multipart) は扱わず null', () => {
    expect(parseByteRange('bytes=0-99,200-299', SIZE)).toBeNull();
  });

  it('bytes= 以外の単位や壊れた書式は null', () => {
    for (const h of ['items=0-99', 'bytes', 'bytes=', 'bytes=abc-def', 'bytes=-', '0-99']) {
      expect(parseByteRange(h, SIZE)).toBeNull();
    }
  });

  it('前後の空白を許容する', () => {
    expect(parseByteRange('  bytes=10-20  ', SIZE)).toEqual({ start: 10, end: 20 });
  });

  it('サイズが 0 以下なら null', () => {
    expect(parseByteRange('bytes=0-1', 0)).toBeNull();
    expect(parseByteRange('bytes=0-1', -1)).toBeNull();
  });

  it('1 バイトのファイルでも破綻しない', () => {
    expect(parseByteRange('bytes=0-0', 1)).toEqual({ start: 0, end: 0 });
    expect(parseByteRange('bytes=0-1', 1)).toEqual({ start: 0, end: 0 });
  });

  it('返す範囲は常に 0 <= start <= end < size', () => {
    const headers = ['bytes=0-1', 'bytes=100-', 'bytes=-500', 'bytes=900-99999', 'bytes=-5000'];
    for (const h of headers) {
      const r = parseByteRange(h, SIZE);
      expect(r).not.toBeNull();
      if (r) {
        expect(r.start).toBeGreaterThanOrEqual(0);
        expect(r.end).toBeLessThan(SIZE);
        expect(r.start).toBeLessThanOrEqual(r.end);
      }
    }
  });
});
