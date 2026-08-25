import {
  validateProgress,
  nextWatchedMs,
  isCompleted,
  watchRatio,
  MAX_PROGRESS_DELTA_MS,
  COMPLETION_RATIO,
} from './video-progress';

describe('validateProgress', () => {
  it('正常な値はそのまま通す', () => {
    const r = validateProgress({ watchedMs: 5000, positionMs: 4800 }, 60000);
    expect(r).toEqual({ ok: true, value: { watchedMs: 5000, positionMs: 4800 } });
  });

  it('0 は「まだ見ていない」の正当な値として通す', () => {
    const r = validateProgress({ watchedMs: 0, positionMs: 0 }, 60000);
    expect(r.ok).toBe(true);
  });

  // クライアントからの自己申告値なので、改造されたリクエストを想定する。
  it('負値を拒否する', () => {
    expect(validateProgress({ watchedMs: -1, positionMs: 0 }, 60000).ok).toBe(false);
    expect(validateProgress({ watchedMs: 0, positionMs: -1 }, 60000).ok).toBe(false);
  });

  it('NaN / Infinity を拒否する', () => {
    expect(validateProgress({ watchedMs: NaN, positionMs: 0 }, 60000).ok).toBe(false);
    expect(validateProgress({ watchedMs: 0, positionMs: NaN }, 60000).ok).toBe(false);
    expect(validateProgress({ watchedMs: Infinity, positionMs: 0 }, 60000).ok).toBe(false);
    expect(validateProgress({ watchedMs: 0, positionMs: -Infinity }, 60000).ok).toBe(false);
  });

  it('小数を整数へ丸める', () => {
    const r = validateProgress({ watchedMs: 1234.9, positionMs: 999.9 }, 60000);
    expect(r.ok && r.value).toEqual({ watchedMs: 1234, positionMs: 999 });
  });

  // 「視聴時間 999 時間」のような値が集計を壊さないこと。
  it('尺の1.1倍を超える値は尺で丸める', () => {
    const r = validateProgress({ watchedMs: 99999999, positionMs: 99999999 }, 60000);
    expect(r.ok && r.value.watchedMs).toBe(66000);
    expect(r.ok && r.value.positionMs).toBe(66000);
  });

  // HLS の尺は実尺と数秒ずれるため、少しの超過は許容する必要がある。
  it('尺をわずかに超える値は許容する（HLSの尺ずれ対策）', () => {
    const r = validateProgress({ watchedMs: 60500, positionMs: 60500 }, 60000);
    expect(r.ok && r.value.watchedMs).toBe(60500);
  });

  it('尺が不明なら上限をかけない', () => {
    const r = validateProgress({ watchedMs: 99999999, positionMs: 5 }, null);
    expect(r.ok && r.value.watchedMs).toBe(99999999);
  });

  it('尺が0なら上限をかけない', () => {
    const r = validateProgress({ watchedMs: 12345, positionMs: 5 }, 0);
    expect(r.ok && r.value.watchedMs).toBe(12345);
  });
});

describe('nextWatchedMs', () => {
  // リロード後の再送やリトライで小さい値が届くことがある。
  // 「見たのに視聴時間が減る」のを防ぐ。
  it('前回より小さい値は無視する', () => {
    expect(nextWatchedMs(10000, 5000)).toBe(10000);
  });

  it('同値なら変わらない', () => {
    expect(nextWatchedMs(10000, 10000)).toBe(10000);
  });

  it('増えた分を反映する', () => {
    expect(nextWatchedMs(10000, 25000)).toBe(25000);
  });

  it('0 から増やせる', () => {
    expect(nextWatchedMs(0, 15000)).toBe(15000);
  });

  // 改造した1リクエストで巨大な値を入れられないこと。
  it('1回の増分が上限を超える場合は上限までに抑える', () => {
    const r = nextWatchedMs(1000, 1000 + MAX_PROGRESS_DELTA_MS + 500000);
    expect(r).toBe(1000 + MAX_PROGRESS_DELTA_MS);
  });

  it('上限ちょうどの増分は通す', () => {
    const r = nextWatchedMs(1000, 1000 + MAX_PROGRESS_DELTA_MS);
    expect(r).toBe(1000 + MAX_PROGRESS_DELTA_MS);
  });

  // タブ非アクティブで送信間隔が伸びるケースを潰さないこと。
  it('送信間隔が多少伸びても通る余裕がある', () => {
    // 15秒間隔の想定に対し、40秒空いたケース
    expect(nextWatchedMs(0, 40000)).toBe(40000);
  });
});

describe('isCompleted', () => {
  it('95%以上で完視聴とみなす', () => {
    expect(isCompleted(95000, 100000)).toBe(true);
    expect(isCompleted(100000, 100000)).toBe(true);
  });

  it('95%未満は完視聴ではない', () => {
    expect(isCompleted(94999, 100000)).toBe(false);
  });

  it('COMPLETION_RATIO と整合している', () => {
    const dur = 100000;
    expect(isCompleted(dur * COMPLETION_RATIO, dur)).toBe(true);
    expect(isCompleted(dur * COMPLETION_RATIO - 1, dur)).toBe(false);
  });

  it('尺が不明なら判定できないので false', () => {
    expect(isCompleted(999999, null)).toBe(false);
    expect(isCompleted(999999, 0)).toBe(false);
  });

  it('未視聴は false', () => {
    expect(isCompleted(0, 100000)).toBe(false);
  });
});

describe('watchRatio', () => {
  it('視聴率を返す', () => {
    expect(watchRatio(50000, 100000)).toBe(0.5);
  });

  // シークで見直すと視聴時間は尺を超え得るが、
  // 「視聴率140%」は表示として意味が読めない。
  it('100%を超えない', () => {
    expect(watchRatio(200000, 100000)).toBe(1);
  });

  it('尺が不明なら null', () => {
    expect(watchRatio(50000, null)).toBeNull();
    expect(watchRatio(50000, 0)).toBeNull();
  });

  it('未視聴は 0', () => {
    expect(watchRatio(0, 100000)).toBe(0);
  });
});
