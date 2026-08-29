/**
 * 動画の視聴集計ロジック (純粋関数のみ)。
 *
 * DB アクセスは `video-analytics-store.ts` に置き、ここは受け取った
 * 生の集計値を「運営が読める指標」に変換する責務だけを持つ。
 * 分けている理由は、割り算の分母の選び方 (下記) が最も間違えやすく、
 * DB 無しでテストできる形にしておく必要があるため。
 *
 * ## 「計測済み」と「未計測」を分ける理由
 *
 * `video_view_logs` は以前から存在したが、`watched_ms` を書く処理が
 * どこにも無かった。つまり計測機能を入れる前の行は
 * すべて watched_ms = 0 / completed = false のまま残っている。
 *
 * これを平均視聴時間の分母に入れると、過去の行が多い動画は
 * 「平均 3 秒」のような実態と乖離した値になる。
 * そこで進捗を 1 度でも受け取れた行 (last_active_at IS NOT NULL) を
 * `measuredCount` として数え、平均系の指標はその分母で計算する。
 *
 * 合計視聴時間 (totalWatchedMs) は分母を持たないので全行の合計でよい。
 * 再生開始回数 (playStarts) も「押された回数」なので全行を数える。
 */

/**
 * 視聴維持率グラフの区間数。20 区間 = 5% 刻み。
 *
 * 10% 刻みから 5% 刻みに細かくしている。10% 刻みだと
 * 「前半で離脱が多い」程度しか分からず、イントロのどこで
 * 切られているかまでは読めなかったため。
 *
 * これ以上細かく (2% 刻みなど) しないのは、区間あたりの
 * 人数が減ってノイズが目立ち、かつバーの本数が増えて
 * 管理画面で一覧できなくなるため。
 */
export const RETENTION_BUCKETS = 20;

/** DB から取得したままの集計値。 */
export type VideoStatsRaw = {
  /** 再生開始回数 (= view log の行数)。同じ人が開き直せば増える。 */
  playStarts: number;
  /** 実際に再生した人数 (ユーザー重複排除)。 */
  uniqueViewers: number;
  /** 全行の watched_ms 合計。 */
  totalWatchedMs: number;
  /** completed = true の行数。 */
  completedCount: number;
  /** 進捗を 1 度でも受け取れた行数 (計測機能導入後の視聴)。 */
  measuredCount: number;
};

/** 管理画面で表示する形に変換した指標。 */
export type VideoStats = {
  playStarts: number;
  uniqueViewers: number;
  totalWatchedMs: number;
  /** 「1時間23分」形式 */
  totalWatchedLabel: string;
  /** 計測済み視聴 1 回あたりの平均視聴時間 (ミリ秒)。計測済みが 0 なら null。 */
  avgWatchedMs: number | null;
  avgWatchedLabel: string;
  /** 平均視聴率 (0〜1)。尺不明または計測済みが 0 なら null。 */
  avgWatchRatio: number | null;
  /** 完視聴率 (0〜1)。計測済みが 0 なら null。 */
  completionRate: number | null;
  measuredCount: number;
  /** 計測機能の導入前に記録された、視聴時間が分からない行数。 */
  unmeasuredCount: number;
};

/**
 * 生の集計値を表示用の指標に変換する。
 *
 * @param durationMs 動画の尺 (ミリ秒)。不明なら null。視聴率の計算に使う。
 */
export function summarizeVideoStats(
  raw: VideoStatsRaw,
  durationMs: number | null,
): VideoStats {
  const measured = Math.max(0, raw.measuredCount);
  // 計測済みが 0 のときに 0 除算で NaN を出さない。
  // null を返して UI 側で「—」を出させる方が、0% と表示して
  // 「誰も見ていない」と誤読されるより安全。
  const avgWatchedMs = measured > 0 ? raw.totalWatchedMs / measured : null;

  const avgWatchRatio =
    avgWatchedMs !== null && durationMs !== null && durationMs > 0
      ? // 100% で丸める。シークで見直すと視聴時間は尺を超え得るが
        // 「視聴率 130%」は指標として読み取れないため。
        Math.min(1, avgWatchedMs / durationMs)
      : null;

  const completionRate = measured > 0 ? raw.completedCount / measured : null;

  return {
    playStarts: raw.playStarts,
    uniqueViewers: raw.uniqueViewers,
    totalWatchedMs: raw.totalWatchedMs,
    totalWatchedLabel: formatMs(raw.totalWatchedMs),
    avgWatchedMs,
    avgWatchedLabel: avgWatchedMs === null ? '—' : formatMs(avgWatchedMs),
    avgWatchRatio,
    completionRate,
    measuredCount: measured,
    // 負にならないよう clamp する。集計クエリのタイミングずれで
    // measured > playStarts になっても表示が壊れないようにする。
    unmeasuredCount: Math.max(0, raw.playStarts - measured),
  };
}

/**
 * 再生位置がどの区間で終わったかを求める。
 *
 * 尺が不明な動画は区間を決められないので null。
 * 尺ちょうど (100%) は最後の区間に入れる。`floor` のままだと
 * インデックスが範囲外 (buckets) になるため。
 */
export function dropOffBucketIndex(
  positionMs: number,
  durationMs: number | null,
  buckets = RETENTION_BUCKETS,
): number | null {
  if (durationMs === null || durationMs <= 0) return null;
  if (!Number.isFinite(positionMs) || positionMs < 0) return null;
  const ratio = positionMs / durationMs;
  const idx = Math.floor(ratio * buckets);
  if (idx < 0) return 0;
  if (idx >= buckets) return buckets - 1;
  return idx;
}

/**
 * 離脱位置の分布から「視聴維持率」に変換する。
 *
 * 離脱分布 (その区間で終わった人数) をそのまま見ても
 * 「どこで人が減ったか」は読み取りにくい。
 * 後ろから累積することで「区間 i まで到達した人数」になり、
 * 右肩下がりのグラフとして直感的に読める。
 *
 * 例: 離脱 [5, 2, 0, 3] → 到達 [10, 5, 3, 3]
 */
export function retentionFromDropOff(dropOff: number[]): number[] {
  const out = new Array<number>(dropOff.length).fill(0);
  let acc = 0;
  for (let i = dropOff.length - 1; i >= 0; i -= 1) {
    acc += dropOff[i] ?? 0;
    out[i] = acc;
  }
  return out;
}

/**
 * 維持率グラフの各バーの表示情報を作る。
 *
 * ratio は先頭区間 (= 到達者の最大値) を 1 とした相対値にする。
 * 総視聴数を分母にすると、計測前の行を含んでしまい
 * すべてのバーが低く見えて形が読めなくなるため。
 */
export function retentionBars(
  dropOff: number[],
  buckets = RETENTION_BUCKETS,
): Array<{ label: string; viewers: number; ratio: number }> {
  const reached = retentionFromDropOff(dropOff);
  const base = reached[0] ?? 0;
  const step = 100 / buckets;
  return reached.map((viewers, i) => ({
    label: `${Math.round(i * step)}〜${Math.round((i + 1) * step)}%`,
    viewers,
    ratio: base > 0 ? viewers / base : 0,
  }));
}

/** ミリ秒を「1時間23分」形式に整形する。 */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0秒';
  return formatSeconds(ms / 1000);
}

/**
 * 秒数を桁の大きさに応じた単位で整形する。
 *
 * `4521 秒` のような生の値は運営が読み取れないため、
 * 時間が付くときは秒を省いて桁を減らす。
 */
export function formatSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0秒';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

/**
 * 比率 (0〜1) をパーセント表示にする。null は「—」。
 *
 * 小数第 1 位まで出す。整数に丸めると、視聴数が少ないうちに
 * 完視聴率が 0% と 100% しか出ず変化が見えないため。
 */
export function formatRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '—';
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  // 整数なら小数点を出さない (「100.0%」より「100%」の方が読みやすい)
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}
