import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@idol/db';
import { MAX_VIDEO_QUALITY, formatJstDate, type PlanTypeLiteral } from '@idol/shared';
import { resolveThumbnailUrlAsync } from '@/lib/video-delivery';
import {
  isVideoListable,
  isVideoPlayable,
  videoLockReason,
} from '@/lib/video-visibility';
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

  if (!video) notFound();

  const plan = (user?.subscriptions[0]?.planType as PlanTypeLiteral) ?? 'FREE';
  const now = new Date();
  const visibility = {
    isPublished: video.isPublished,
    status: video.status,
    publishedAt: video.publishedAt,
    expiresAt: video.expiresAt,
    accessLevel: video.accessLevel,
  };

  // 非公開 / 未エンコード / 公開前は存在を伏せる (404)。
  if (!isVideoListable(visibility, now)) notFound();

  // 公開中でもプランが足りない場合はサムネイルのみ見せて再生はさせない。
  const allowed = isVideoPlayable(visibility, plan, now);
  const lockReason = videoLockReason(visibility, plan, now);
  const expired = lockReason === 'この動画の配信期間は終了しました。';
  const thumbnailUrl = await resolveThumbnailUrlAsync(video.thumbnailUrl);
  const maxHeight = QUALITY_HEIGHT[MAX_VIDEO_QUALITY[plan]] ?? 720;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4">
        <Link href="/me/videos" className="text-sm text-slate-500 hover:text-slate-700">
          ← 動画一覧へ
        </Link>
      </div>

      {allowed ? (
        <VideoWatch videoId={video.id} maxHeight={maxHeight} thumbnailUrl={thumbnailUrl} />
      ) : (
        // 再生不可でもサムネイルは見せる (何の動画か分からないと入会の動機にならない)。
        // 動画本体の URL は発行しないので再生はできない。
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="relative aspect-video w-full bg-slate-900">
            {thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailUrl}
                alt={video.title}
                className="h-full w-full object-cover opacity-40"
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center text-center text-white">
              <div className="space-y-3 px-6">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                  className="mx-auto"
                >
                  <path
                    d="M6 10V8a6 6 0 1112 0v2m-9 0h6a3 3 0 013 3v5a3 3 0 01-3 3H9a3 3 0 01-3-3v-5a3 3 0 013-3z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <p className="text-sm">{lockReason}</p>
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
