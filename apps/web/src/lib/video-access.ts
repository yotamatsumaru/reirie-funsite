/**
 * 動画視聴の共通アクセス判定。
 *
 * `/api/videos/[id]/playback` (署名URL発行) と
 * `/api/videos/[id]/hls/[...path]` (プレイリストプロキシ) で
 * 同じ条件を使うために切り出したもの。
 */
import { prisma } from '@idol/db';
import { canAccess } from '@idol/shared';
import type { PlanTypeLiteral, AccessLevelLiteral } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors } from '@/lib/errors';

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
 *  - status === 'READY' かつ s3HlsKey がある
 *  - 配信許諾期限内
 *  - プランが accessLevel を満たす
 */
export async function requirePlayableVideo(req: Request, id: string): Promise<PlayableResult> {
  const session = await requireApiSession(req);
  const plan = session.user.plan;

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video || video.status !== 'READY' || !video.s3HlsKey) {
    throw errors.notFound('動画が見つかりません');
  }
  if (video.expiresAt && video.expiresAt <= new Date()) {
    throw errors.forbidden('配信許諾期限が切れています');
  }
  const accessLevel = video.accessLevel as AccessLevelLiteral;
  if (!canAccess(plan, accessLevel)) {
    throw errors.planRequired(accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }

  return {
    video: { id: video.id, s3HlsKey: video.s3HlsKey, accessLevel },
    userId: session.user.id,
    plan,
    userAgent: req.headers.get('User-Agent') ?? undefined,
  };
}
