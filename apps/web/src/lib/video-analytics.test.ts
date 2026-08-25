import {
  summarizeVideoStats,
  dropOffBucketIndex,
  retentionFromDropOff,
  retentionBars,
  formatMs,
  formatSeconds,
  formatRatio,
  RETENTION_BUCKETS,
  type VideoStatsRaw,
} from './video-analytics';

const raw = (o: Partial<VideoStatsRaw> = {}): VideoStatsRaw => ({
  playStarts: 0,
  uniqueViewers: 0,
  totalWatchedMs: 0,
  completedCount: 0,
  measuredCount: 0,
  ...o,
});

describe('summarizeVideoStats', () => {
  it('視聴が無いとき平均系は null になる（0% と誤読させない）', () => {
    const s = summarizeVideoStats(raw(), 60_000);
    expect(s.avgWatchedMs).toBeNull();
    expect(s.avgWatchRatio).toBeNull();
    expect(s.completionRate).toBeNull();
    expect(s.avgWatchedLabel).toBe('—');
    expect(s.totalWatchedLabel).toBe('0秒');
  });

  it('平均視聴時間は計測済み行数で割る（計測前の行を分母に入れない）', () => {
    // 10 回再生されたが、計測機能導入後は 2 回だけ
    const s = summarizeVideoStats(
      raw({ playStarts: 10, measuredCount: 2, totalWatchedMs: 60_000 }),
      120_000,
    );
    expect(s.avgWatchedMs).toBe(30_000);
    expect(s.unmeasuredCount).toBe(8);
  });

  it('平均視聴率は尺に対する割合になる', () => {
    const s = summarizeVideoStats(
      raw({ playStarts: 2, measuredCount: 2, totalWatchedMs: 60_000 }),
      60_000,
    );
    // 平均 30 秒 / 尺 60 秒 = 50%
    expect(s.avgWatchRatio).toBeCloseTo(0.5);
  });

  it('尺が不明なら視聴率は null（合計視聴時間は出せる）', () => {
    const s = summarizeVideoStats(
      raw({ playStarts: 1, measuredCount: 1, totalWatchedMs: 30_000 }),
      null,
    );
    expect(s.avgWatchRatio).toBeNull();
    expect(s.avgWatchedMs).toBe(30_000);
    expect(s.totalWatchedLabel).toBe('30秒');
  });

  it('視聴率は 100% を超えない（見直しで尺を超えても丸める）', () => {
    const s = summarizeVideoStats(
      raw({ playStarts: 1, measuredCount: 1, totalWatchedMs: 300_000 }),
      60_000,
    );
    expect(s.avgWatchRatio).toBe(1);
  });

  it('完視聴率は計測済み行数に対する割合', () => {
    const s = summarizeVideoStats(
      raw({ playStarts: 4, measuredCount: 4, completedCount: 3 }),
      60_000,
    );
    expect(s.completionRate).toBeCloseTo(0.75);
  });

  it('measuredCount が playStarts を超えても未計測数は負にならない', () => {
    const s = summarizeVideoStats(raw({ playStarts: 1, measuredCount: 5 }), null);
    expect(s.unmeasuredCount).toBe(0);
  });

  it('playStarts と uniqueViewers はそのまま通す', () => {
    const s = summarizeVideoStats(raw({ playStarts: 12, uniqueViewers: 5 }), null);
    expect(s.playStarts).toBe(12);
    expect(s.uniqueViewers).toBe(5);
  });
});

describe('dropOffBucketIndex', () => {
  it('尺不明なら null', () => {
    expect(dropOffBucketIndex(1000, null)).toBeNull();
    expect(dropOffBucketIndex(1000, 0)).toBeNull();
  });

  it('先頭は区間 0', () => {
    expect(dropOffBucketIndex(0, 100_000)).toBe(0);
  });

  it('10% 刻みで区間が進む', () => {
    expect(dropOffBucketIndex(10_000, 100_000)).toBe(1);
    expect(dropOffBucketIndex(55_000, 100_000)).toBe(5);
  });

  it('尺ちょうどは最後の区間に入る（範囲外にならない）', () => {
    expect(dropOffBucketIndex(100_000, 100_000)).toBe(RETENTION_BUCKETS - 1);
  });

  it('尺を超える位置も最後の区間に丸める', () => {
    expect(dropOffBucketIndex(500_000, 100_000)).toBe(RETENTION_BUCKETS - 1);
  });

  it('不正な位置は null', () => {
    expect(dropOffBucketIndex(NaN, 100_000)).toBeNull();
    expect(dropOffBucketIndex(-1, 100_000)).toBeNull();
  });

  it('区間数を指定できる', () => {
    expect(dropOffBucketIndex(50_000, 100_000, 4)).toBe(2);
    expect(dropOffBucketIndex(100_000, 100_000, 4)).toBe(3);
  });
});

describe('retentionFromDropOff', () => {
  it('後ろから累積して到達者数にする', () => {
    expect(retentionFromDropOff([5, 2, 0, 3])).toEqual([10, 5, 3, 3]);
  });

  it('全員が最後まで見た場合は全区間が同数', () => {
    expect(retentionFromDropOff([0, 0, 0, 4])).toEqual([4, 4, 4, 4]);
  });

  it('全員が冒頭で離脱した場合は先頭だけ', () => {
    expect(retentionFromDropOff([4, 0, 0, 0])).toEqual([4, 0, 0, 0]);
  });

  it('空配列は空配列', () => {
    expect(retentionFromDropOff([])).toEqual([]);
  });
});

describe('retentionBars', () => {
  it('先頭区間を基準にした相対値になる', () => {
    const bars = retentionBars([5, 5, 0, 0], 4);
    expect(bars.map((b) => b.viewers)).toEqual([10, 5, 0, 0]);
    expect(bars[0]?.ratio).toBe(1);
    expect(bars[1]?.ratio).toBeCloseTo(0.5);
  });

  it('視聴が無ければ ratio は 0（NaN にしない）', () => {
    const bars = retentionBars([0, 0], 2);
    expect(bars.every((b) => b.ratio === 0)).toBe(true);
  });

  it('区間ラベルはパーセント範囲になる', () => {
    const bars = retentionBars([1, 0, 0, 0], 4);
    expect(bars[0]?.label).toBe('0〜25%');
    expect(bars[3]?.label).toBe('75〜100%');
  });
});

describe('formatSeconds / formatMs', () => {
  it('0 以下と不正値は 0秒', () => {
    expect(formatSeconds(0)).toBe('0秒');
    expect(formatSeconds(-5)).toBe('0秒');
    expect(formatSeconds(NaN)).toBe('0秒');
    expect(formatMs(0)).toBe('0秒');
    expect(formatMs(Infinity)).toBe('0秒');
  });

  it('1分未満は秒だけ', () => {
    expect(formatSeconds(45)).toBe('45秒');
  });

  it('1分以上は分と秒', () => {
    expect(formatSeconds(90)).toBe('1分30秒');
  });

  it('1時間以上は時間と分（秒は省く）', () => {
    expect(formatSeconds(3661)).toBe('1時間1分');
  });

  it('formatMs はミリ秒を秒に直して整形する', () => {
    expect(formatMs(90_000)).toBe('1分30秒');
    expect(formatMs(3_600_000)).toBe('1時間0分');
  });
});

describe('formatRatio', () => {
  it('null は —', () => {
    expect(formatRatio(null)).toBe('—');
    expect(formatRatio(NaN)).toBe('—');
  });

  it('整数パーセントは小数点を出さない', () => {
    expect(formatRatio(0)).toBe('0%');
    expect(formatRatio(0.5)).toBe('50%');
    expect(formatRatio(1)).toBe('100%');
  });

  it('端数は小数第1位まで', () => {
    expect(formatRatio(0.333)).toBe('33.3%');
  });

  it('範囲外は 0〜100% に丸める', () => {
    expect(formatRatio(1.5)).toBe('100%');
    expect(formatRatio(-0.2)).toBe('0%');
  });
});
