/**
 * 動画視聴の共通アクセス判定。
 *
 * `/api/videos/[id]/playback` (署名URL発行) と
 * `/api/videos/[id]/hls/[...path]` (プレイリストプロキシ) で
 * 同じ条件を使うために切り出したもの。
 */
import { prisma } from '@idol/db';
import type { PlanTypeLiteral, AccessLevelLiteral } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors } from '@/lib/errors';
import { isVideoListable, isVideoPlayable, isVideoExpired } from '@/lib/video-visibility';

export type PlayableVideo = {
  id: string;
  s3HlsKey: string;
  accessLevel: AccessLevelLiteral;
};

export type PlayableResult = {
  video: PlayableVideo;
  userId: string;
  plan: PlanTypeLiteral;
  userAgent?: string;
};

/**
 * 視聴可能な動画を取得する。以下のいずれかを満たさない場合は例外を投げる。
 *  - ログイン済み (Cookie セッション or Bearer トークン)
 *  - 公開中 (isPublished) かつ status === 'READY' かつ s3HlsKey がある
 *  - 公開開始済み / 配信許諾期限内
 *  - プランが accessLevel を満たす
 *
 * ここが再生の最終ゲート。無料プランでも一覧・詳細ではサムネイルが見えるが、
 * HLS の URL を発行するのはこの関数を通ったときだけなので、
 * UI を細工しても再生はできない。
 */
export async function requirePlayableVideo(req: Request, id: string): Promise<PlayableResult> {
  const session = await requireApiSession(req);
  const plan = session.user.plan;

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video || !video.s3HlsKey) {
    throw errors.notFound('動画が見つかりません');
  }

  const accessLevel = video.accessLevel as AccessLevelLiteral;
  const visibility = {
    isPublished: video.isPublished,
    status: video.status,
    publishedAt: video.publishedAt,
    expiresAt: video.expiresAt,
    accessLevel,
  };
  const now = new Date();

  // 非公開 / 未エンコード / 公開前は存在を伏せる (404)
  if (!isVideoListable(visibility, now)) {
    if (isVideoExpired(visibility, now)) {
      throw errors.forbidden('配信許諾期限が切れています');
    }
    throw errors.notFound('動画が見つかりません');
  }
  if (!isVideoPlayable(visibility, plan, now)) {
    throw errors.planRequired(accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }

  return {
    video: { id: video.id, s3HlsKey: video.s3HlsKey, accessLevel },
    userId: session.user.id,
    plan,
    userAgent: req.headers.get('User-Agent') ?? undefined,
  };
}
