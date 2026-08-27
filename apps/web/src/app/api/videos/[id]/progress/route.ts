/**
 * PATCH /api/videos/[id]/progress
 *
 * 再生中のクライアントから視聴進捗を受け取り、視聴ログ 1 行を更新する。
 *
 * ## なぜ必要か
 * これまで記録されていたのは「再生ボタンを押した瞬間」だけで、
 * `watched_ms` 列は存在するのに常に 0 だった。そのため
 * 「3 秒で閉じた人」と「最後まで見た人」を区別できず、
 * 管理画面の視聴回数は実質「再生開始回数」でしかなかった。
 *
 * ## なぜ行を増やさず更新するのか
 * 15 秒間隔で INSERT すると 1 時間の動画で 240 行になり、
 * 「行数 = 視聴回数」という既存の意味が壊れる
 * (管理画面の視聴回数が 240 倍に見える)。
 * 1 視聴 = 1 行に集約し、その行を上書きしていく。
 *
 * ## セキュリティ / 不正対策
 * 送られてくる数値は視聴者のブラウザからの自己申告で、
 * 開発者ツールから任意の値を送れる。以下で守る:
 *   1. ログイン必須 + 対象動画が視聴可能であることを再確認
 *      (再生権限が切れた後も送り続けられないようにする)
 *   2. 視聴ログの所有者が本人であることを確認
 *      (他人の視聴ログを書き換えられないようにする)
 *   3. 値は動画の尺で丸め、1 回の増分にも上限をかける
 *      (video-progress.ts の validateProgress / nextWatchedMs)
 *
 * ## 失敗時の扱い
 * 計測は付加的な機能なので、失敗しても再生を妨げない設計にしている。
 * クライアント側は結果を無視して送り続ける (keepalive fetch)。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { handle, errors } from '@/lib/errors';
import { requirePlayableVideo } from '@/lib/video-access';
import { validateProgress, nextWatchedMs, isCompleted } from '@/lib/video-progress';

export const runtime = 'nodejs';

const BodySchema = z.object({
  /** playback API が返した視聴ログ ID */
  viewLogId: z.string().uuid(),
  /** 累計視聴時間 (ミリ秒)。クライアントが再生イベントから積算した値 */
  watchedMs: z.number(),
  /** 最後の再生位置 (ミリ秒) */
  positionMs: z.number(),
});

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;

  // 再生権限を再確認する。playback 時に通っていても、その後に
  // 非公開化・配信期限切れ・プラン解約が起き得るため。
  // ここを省くと「見られなくなった動画の視聴時間が伸び続ける」ことになる。
  const { video, userId } = await requirePlayableVideo(req, id);

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }
  const body = parsed.data;

  // 動画の尺を取得する。進捗の上限と完視聴判定に使う。
  // durationSeconds は MediaConvert 完了時に入るため、
  // 未エンコードや尺が取れなかった動画では null になり得る。
  const meta = await prisma.video.findUnique({
    where: { id: video.id },
    select: { durationSeconds: true },
  });
  const durationMs = meta?.durationSeconds ? meta.durationSeconds * 1000 : null;

  const check = validateProgress(
    { watchedMs: body.watchedMs, positionMs: body.positionMs },
    durationMs,
  );
  if (!check.ok) throw errors.unprocessable(check.message);

  // 視聴ログの所有者確認。userId まで where に入れることで、
  // 他人の視聴ログ ID を渡しても 0 件更新となり書き換えられない。
  const existing = await prisma.videoViewLog.findFirst({
    where: { id: body.viewLogId, userId, videoId: video.id },
    select: { id: true, watchedMs: true, lastPositionMs: true, completed: true },
  });
  if (!existing) throw errors.notFound('視聴ログが見つかりません');

  // 視聴時間は単調増加させる (リロード後の再送で減らない)。
  const watched = nextWatchedMs(existing.watchedMs, check.value.watchedMs);
  const position = check.value.positionMs;

  // 一度 completed になった視聴を false に戻さない。
  // 最後まで見た後に先頭へシークして閉じると position が小さくなるが、
  // 「最後まで見た」という事実は変わらないため。
  const completed = existing.completed || isCompleted(position, durationMs);

  await prisma.videoViewLog.update({
    where: { id: existing.id },
    data: {
      watchedMs: watched,
      lastPositionMs: position,
      completed,
      lastActiveAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, watchedMs: watched, completed });
});
