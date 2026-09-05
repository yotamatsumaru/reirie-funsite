import { fitWithin, probeVideoFile } from './video-poster';

describe('fitWithin', () => {
  it('上限以内ならそのまま返す', () => {
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it('上限ちょうどは縮小しない', () => {
    expect(fitWithin(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('横長が上限を超えたら長辺を上限に合わせる', () => {
    // 1920x1080 → 長辺 1280 に合わせて 1280x720
    expect(fitWithin(1920, 1080)).toEqual({ width: 1280, height: 720 });
  });

  it('縦長 (スマホ撮影) でも長辺基準で縮小する', () => {
    // 1080x1920 → 720x1280
    expect(fitWithin(1080, 1920)).toEqual({ width: 720, height: 1280 });
  });

  it('縦横比を維持する', () => {
    const r = fitWithin(3000, 2000);
    expect(r.width / r.height).toBeCloseTo(3000 / 2000, 2);
  });

  it('maxEdge を指定できる', () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ width: 100, height: 50 });
  });

  it('不正な寸法は 0 を返す (呼び出し側で捨てる)', () => {
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [-1, 100],
      [NaN, 100],
      [Infinity, 100],
    ] as const) {
      expect(fitWithin(w, h)).toEqual({ width: 0, height: 0 });
    }
  });

  it('整数に丸める (canvas の幅・高さは整数である必要がある)', () => {
    const r = fitWithin(1333, 999);
    expect(Number.isInteger(r.width)).toBe(true);
    expect(Number.isInteger(r.height)).toBe(true);
  });
});

describe('probeVideoFile', () => {
  it('DOM が無い環境 (SSR / node) では例外を投げず null を返す', async () => {
    // jest は node 環境なので document が存在しない。
    // ここで throw すると SSR 時にページ全体が落ちるため、
    // 安全側に倒れることを保証しておく。
    const file = { name: 'a.mp4', type: 'video/mp4', size: 1 } as unknown as File;
    await expect(probeVideoFile(file)).resolves.toEqual({
      durationSeconds: null,
      poster: null,
    });
  });
});
