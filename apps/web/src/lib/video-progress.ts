/**
 * 動画の視聴計測ロジック (純粋関数のみ)。
 *
 * DB / prisma に触る処理は API ルート側に置く。ここを純粋に保つ理由は、
 * 計測は「クライアントから送られてきた自己申告の数値」を扱うため
 * 検証と丸めの規則が最も間違えやすく、DB 無しでテストできる形が必要なため。
 *
 * ## なぜ必要か
 *
 * これまで `video_view_logs` に記録されていたのは
 * 「/api/videos/[id]/playback を叩いた瞬間」= 再生ボタンを押した回数だけで、
 * `watched_ms` 列は存在するのに常に 0 のまま書かれていた。
 * そのため管理画面の「視聴回数」は
 *   - 3 秒で離脱した人も 1 回
 *   - 最後まで見た人も 1 回
 *   - 同じ人が読み込み直すたびに +1
 * と数えており、「どれくらい見られたか」を判断できなかった。
 *
 * ## 設計: 1 視聴 = 1 行を更新していく
 *
 * 再生開始時に作った行 (view log) を、再生中に定期送信される進捗で
 * **更新**していく。行を増やさないのは:
 *   - 30 秒ごとに行を作ると 1 時間の動画で 120 行になり、
 *     視聴回数 (= 行数) の意味が壊れる
 *   - 「その視聴でどこまで見たか」は 1 行に集約されている方が集計が単純
 *
 * ## 3 つの数値を分けて持つ理由
 *
 * | 列 | 意味 | 用途 |
 * |---|---|---|
 * | `watchedMs` | 実際に再生された時間の累計 | 「合計何分見られたか」 |
 * | `lastPositionMs` | 最後に見ていた再生位置 | 途中再開、離脱ポイント |
 * | `completed` | 実質的に最後まで見たか | 完視聴率 |
 *
 * `watchedMs` と `lastPositionMs` を分けるのは、シークで巻き戻して
 * 見直した場合に「位置は戻るが視聴時間は増える」ため。位置だけを見ると
 * 見直した人の視聴時間を過小評価し、視聴時間だけを見ると
 * 「どこで離脱したか」が分からない。
 */

/** 進捗の送信間隔 (秒)。クライアントとサーバの検証で共有する。 */
export const PROGRESS_INTERVAL_SEC = 15;

/**
 * 1 回の進捗送信で許容する視聴時間の増分の上限 (ミリ秒)。
 *
 * 送信間隔の 4 倍まで許す。厳密に間隔ぴったりにしないのは:
 *   - タブが非アクティブだと setInterval が間引かれ、間隔が伸びる
 *   - 送信失敗のリトライで間隔が空く
 * 一方で無制限に受け付けると、改造したリクエストで
 * 「1 回の送信で 100 時間視聴」といった値を入れられてしまう。
 */
export const MAX_PROGRESS_DELTA_MS = PROGRESS_INTERVAL_SEC * 4 * 1000;

/**
 * 「最後まで見た」と判定する到達率。
 *
 * 100% を要求しないのは、エンドロールやフェードアウトで数秒残して
 * 離脱するのが普通で、また HLS の尺は実尺と数百ミリ秒ずれることがあるため。
 * 95% は動画配信サービスで一般的に使われる水準に合わせている。
 */
export const COMPLETION_RATIO = 0.95;

export type ProgressInput = {
  /** クライアントが申告する累計視聴時間 (ミリ秒) */
  watchedMs: number;
  /** 最後の再生位置 (ミリ秒) */
  positionMs: number;
};

export type ProgressCheck =
  | { ok: true; value: ProgressInput }
  | { ok: false; message: string };

/**
 * クライアントから送られた進捗値を検証・正規化する。
 *
 * ## なぜ検証が必要か
 * この値は視聴者のブラウザから送られる自己申告で、
 * 開発者ツールから任意の数値を送れる。無検証で保存すると
 * 「視聴時間 999 時間」のような値が集計を破壊する。
 *
 * ## 動画の尺で上限を切る
 * `durationMs` が分かっている場合、視聴時間も位置もそれを超えられない
 * (シークで見直せば実時間は尺を超え得るが、それを許すと
 *  水増しの余地になるため尺で丸める。統計の目的は
 *  「どれくらい見られたか」であって実時間の厳密な計測ではない)。
 *
 * 負値・NaN・Infinity は不正な入力として弾く。0 は
 * 「まだ何も見ていない」の正当な値なので通す。
 */
export function validateProgress(
  raw: { watchedMs: number; positionMs: number },
  durationMs: number | null,
): ProgressCheck {
  const { watchedMs, positionMs } = raw;

  if (!Number.isFinite(watchedMs) || !Number.isFinite(positionMs)) {
    return { ok: false, message: '視聴時間の値が不正です' };
  }
  if (watchedMs < 0 || positionMs < 0) {
    return { ok: false, message: '視聴時間の値が不正です' };
  }

  // 小数のミリ秒は精度として無意味なので整数へ丸める
  // (Prisma の Int 列に入れる必要もある)。
  let w = Math.floor(watchedMs);
  let p = Math.floor(positionMs);

  if (durationMs !== null && durationMs > 0) {
    // 尺の 1 割の余裕を持たせる。HLS の尺は実尺と数百ミリ秒〜数秒ずれるため、
    // 厳密に切ると最後まで見た人の値が削られて完視聴と判定されなくなる。
    const cap = Math.floor(durationMs * 1.1);
    w = Math.min(w, cap);
    p = Math.min(p, cap);
  }

  return { ok: true, value: { watchedMs: w, positionMs: p } };
}

/**
 * 保存すべき視聴時間を決める。
 *
 * ## 単調増加にする理由
 * クライアントは累計値を送るが、リロード後の再送やリトライで
 * 前回より小さい値が届くことがある。小さい方で上書きすると
 * 「見たのに視聴時間が減る」ため、常に大きい方を採る。
 *
 * ## 増分に上限をかける理由
 * 一方で「常に大きい方」だけだと、改造した 1 リクエストで
 * 巨大な値を入れられる。前回値からの増分を
 * `MAX_PROGRESS_DELTA_MS` で切ることで、正常な送信間隔では
 * 影響が無く、異常な飛びだけを抑える。
 */
export function nextWatchedMs(previousMs: number, incomingMs: number): number {
  if (incomingMs <= previousMs) return previousMs;
  const delta = incomingMs - previousMs;
  if (delta > MAX_PROGRESS_DELTA_MS) {
    return previousMs + MAX_PROGRESS_DELTA_MS;
  }
  return incomingMs;
}

/**
 * 実質的に最後まで見たかを判定する。
 *
 * 判定は「再生位置」で行い「累計視聴時間」では行わない。
 * 視聴時間で判定すると、冒頭 10 秒を繰り返し再生しただけで
 * 尺に達してしまい完視聴になってしまう。
 *
 * 尺が不明 (durationMs が null / 0) の動画は判定できないので false。
 * エンコード前や尺が取れなかった動画が該当する。
 */
export function isCompleted(positionMs: number, durationMs: number | null): boolean {
  if (durationMs === null || durationMs <= 0) return false;
  return positionMs >= durationMs * COMPLETION_RATIO;
}

/**
 * 視聴率 (0〜1)。尺が不明なら null。
 *
 * 100% を超えないよう丸める。シークで見直すと視聴時間は尺を超え得るが、
 * 「視聴率 140%」は集計表示として意味が読み取れないため。
 */
export function watchRatio(watchedMs: number, durationMs: number | null): number | null {
  if (durationMs === null || durationMs <= 0) return null;
  return Math.min(1, watchedMs / durationMs);
}

// 表示用の整形 (formatSeconds / formatRatio) は `video-analytics.ts` に置く。
// このモジュールは「クライアントから届いた値をどう受け入れるか」の
// 判断だけを持ち、表示の都合を混ぜないようにしている。
