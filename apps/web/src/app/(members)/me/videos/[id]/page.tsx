import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@idol/db';
import {
  canAccess,
  MAX_VIDEO_QUALITY,
  formatJstDate,
  type PlanTypeLiteral,
} from '@idol/shared';
import { resolveThumbnailUrl } from '@/lib/cdn-signer';
import { VideoWatch } from './watch';

export const metadata: Metadata = { title: '動画を見る' };
export const dynamic = 'force-dynamic';

const QUALITY_HEIGHT: Record<string, number> = { '480p': 480, '720p': 720, '1080p': 1080 };

export default async function MemberVideoWatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/signin?callbackUrl=/me/videos/${id}`);

  const [user, video] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    }),
    prisma.video.findUnique({ where: { id } }),
  ]);

  if (!video || video.status !== 'READY' || !video.publishedAt) notFound();

  const plan = (user?.subscriptions[0]?.planType as PlanTypeLiteral) ?? 'FREE';
  const now = new Date();
  const expired = video.expiresAt != null && video.expiresAt <= now;
  const allowed = canAccess(plan, video.accessLevel) && !expired;
  const maxHeight = QUALITY_HEIGHT[MAX_VIDEO_QUALITY[plan]] ?? 720;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4">
        <Link href="/me/videos" className="text-sm text-slate-500 hover:text-slate-700">
          ← 動画一覧へ
        </Link>
      </div>

      {allowed ? (
        <VideoWatch
          videoId={video.id}
          maxHeight={maxHeight}
          thumbnailUrl={resolveThumbnailUrl(video.thumbnailUrl)}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex aspect-video items-center justify-center bg-slate-900 text-center text-white">
            <div className="space-y-3 px-6">
              <p className="text-sm">
                {expired
                  ? 'この動画の配信期間は終了しました。'
                  : video.accessLevel === 'PREMIUM'
                    ? 'この動画はプレミアムプラン限定です。'
                    : 'この動画は会員限定です。'}
              </p>
              {!expired && (
                <Link
                  href="/plans"
                  className="inline-block rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
                >
                  プランを見る
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        <h1 className="text-lg font-bold text-slate-800 sm:text-xl">{video.title}</h1>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {video.publishedAt && <span>{formatJstDate(video.publishedAt)}</span>}
          <span>・最大 {MAX_VIDEO_QUALITY[plan]}</span>
        </div>
        {video.description && (
          <p className="whitespace-pre-wrap text-sm text-slate-600">{video.description}</p>
        )}
      </div>
    </main>
  );
}
