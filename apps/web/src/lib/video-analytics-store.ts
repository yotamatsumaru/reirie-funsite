/**
 * 動画の視聴集計を DB から取得する層。
 *
 * 集計の意味づけ・整形は `video-analytics.ts` (純粋関数) 側に置き、
 * ここは「どのクエリで数えるか」だけを持つ。
 *
 * ## 集計を SQL 側でやる理由
 *
 * 視聴ログは 1 動画あたり数万行になり得る。行を全部取ってから
 * JS で合計すると、動画詳細ページを開くだけでメモリと転送量を食う。
 * 合計・平均・重複排除はすべて DB が得意な処理なので SQL に寄せる。
 *
 * ## `last_active_at IS NOT NULL` で計測済みを判定する理由
 *
 * 計測機能を入れる前の行は watched_ms = 0 のまま残っている。
 * `watched_ms > 0` で判定すると「再生したがすぐ閉じて 0 秒だった」
 * 正当な視聴も未計測に混ざる。進捗リクエストを 1 度でも受け取れば
 * last_active_at が入るので、これが「計測できた視聴」の正しい印になる。
 */
import { prisma } from '@idol/db';
import {
  summarizeVideoStats,
  dropOffBucketIndex,
  RETENTION_BUCKETS,
  type VideoStats,
} from './video-analytics';

export type VideoAnalytics = {
  stats: VideoStats;
  /** 離脱位置の分布 (区間ごとの人数)。尺不明なら null。 */
  dropOff: number[] | null;
};

/**
 * 1 本の動画の視聴集計を取る。
 *
 * @param durationSeconds 動画の尺 (秒)。null なら視聴率系は算出しない。
 */
export async function getVideoAnalytics(
  videoId: string,
  durationSeconds: number | null,
): Promise<VideoAnalytics> {
  const durationMs = durationSeconds && durationSeconds > 0 ? durationSeconds * 1000 : null;

  // 集計は 1 クエリにまとめる。指標ごとにクエリを投げると
  // ページ表示のたびに往復が増え、かつ集計時点がずれて
  // 「完視聴数 > 総視聴数」のような矛盾した表示が起きうる。
  const rows = await prisma.$queryRaw<
    Array<{
      play_starts: bigint;
      unique_viewers: bigint;
      total_watched_ms: bigint | null;
      completed_count: bigint;
      measured_count: bigint;
    }>
  >`
    SELECT
      COUNT(*)                                        AS play_starts,
      COUNT(DISTINCT user_id)                         AS unique_viewers,
      COALESCE(SUM(watched_ms), 0)                    AS total_watched_ms,
      COUNT(*) FILTER (WHERE completed)               AS completed_count,
      COUNT(*) FILTER (WHERE last_active_at IS NOT NULL) AS measured_count
    FROM video_view_logs
    WHERE video_id = ${videoId}::uuid
  `;

  const r = rows[0];
  const stats = summarizeVideoStats(
    {
      // Postgres の COUNT/SUM は bigint で返るため Number へ落とす。
      // 視聴回数・ミリ秒合計が 2^53 を超えることは現実的に無い
      // (ミリ秒合計で約 28 万年ぶん)。
      playStarts: Number(r?.play_starts ?? 0),
      uniqueViewers: Number(r?.unique_viewers ?? 0),
      totalWatchedMs: Number(r?.total_watched_ms ?? 0),
      completedCount: Number(r?.completed_count ?? 0),
      measuredCount: Number(r?.measured_count ?? 0),
    },
    durationMs,
  );

  const dropOff = durationMs === null ? null : await getDropOff(videoId, durationMs);
  return { stats, dropOff };
}

/**
 * 離脱位置の分布を取る。
 *
 * 区間分けは JS 側で行う。SQL の width_bucket でもできるが、
 * 区間の境界の扱い (尺ちょうどをどちらに入れるか) をテスト済みの
 * `dropOffBucketIndex` と一致させたいため。
 *
 * 対象は計測済み (last_active_at IS NOT NULL) の行のみ。
 * 計測前の行は last_position_ms = 0 なので、含めると
 * 「全員が冒頭で離脱した」グラフになってしまう。
 */
async function getDropOff(videoId: string, durationMs: number): Promise<number[]> {
  const rows = await prisma.videoViewLog.findMany({
    where: { videoId, lastActiveAt: { not: null } },
    select: { lastPositionMs: true },
    // 上限を設ける。分布の形を見るのが目的なので全件は不要で、
    // 人気動画で数万行を読み込むとページ表示が遅くなる。
    take: 5000,
    orderBy: { createdAt: 'desc' },
  });

  const buckets = new Array<number>(RETENTION_BUCKETS).fill(0);
  for (const row of rows) {
    const idx = dropOffBucketIndex(row.lastPositionMs, durationMs);
    if (idx !== null) buckets[idx] = (buckets[idx] ?? 0) + 1;
  }
  return buckets;
}

/** 一覧表示用の 1 行ぶんの集計。 */
export type VideoListStat = {
  videoId: string;
  playStarts: number;
  uniqueViewers: number;
  totalWatchedMs: number;
};

/**
 * 複数動画の集計をまとめて取る (一覧ページ用)。
 *
 * 動画ごとに `getVideoAnalytics` を呼ぶと N+1 になり、
 * 50 件の一覧で 50 回以上クエリが走る。GROUP BY で 1 クエリにまとめる。
 *
 * ## Prisma の groupBy / distinct を使わない理由
 *
 * `COUNT(DISTINCT user_id)` を Prisma の API で表現できない。
 * `findMany({ distinct: ['videoId','userId'] })` は
 * **行を全部取ってからアプリ側で重複排除する**実装なので、
 * 視聴ログが数万行あると一覧を開くだけで全行を転送してしまう。
 * 生 SQL なら DB 内で数え切れる。
 *
 * 空配列のときはクエリを投げない。`IN ()` は SQL として不正なため。
 */
export async function getVideoListStats(
  videoIds: string[],
): Promise<Map<string, VideoListStat>> {
  const out = new Map<string, VideoListStat>();
  if (videoIds.length === 0) return out;

  const rows = await prisma.$queryRaw<
    Array<{
      video_id: string;
      play_starts: bigint;
      unique_viewers: bigint;
      total_watched_ms: bigint | null;
    }>
  >`
    SELECT
      video_id::text                AS video_id,
      COUNT(*)                      AS play_starts,
      COUNT(DISTINCT user_id)       AS unique_viewers,
      COALESCE(SUM(watched_ms), 0)  AS total_watched_ms
    FROM video_view_logs
    WHERE video_id = ANY(${videoIds}::uuid[])
    GROUP BY video_id
  `;

  for (const r of rows) {
    out.set(r.video_id, {
      videoId: r.video_id,
      playStarts: Number(r.play_starts),
      uniqueViewers: Number(r.unique_viewers),
      totalWatchedMs: Number(r.total_watched_ms ?? 0),
    });
  }
  return out;
}
