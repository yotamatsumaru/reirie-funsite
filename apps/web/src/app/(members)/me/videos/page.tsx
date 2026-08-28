import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@idol/db';
import { accessLevelLabel, formatJstDate, type PlanTypeLiteral } from '@idol/shared';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { resolveThumbnailUrls } from '@/lib/video-delivery';
import { listableVideoWhere, isVideoPlayable } from '@/lib/video-visibility';

export const metadata: Metadata = { title: '動画' };
export const dynamic = 'force-dynamic';

export default async function MemberVideosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/videos');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      subscriptions: {
        where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
  const plan = (user?.subscriptions[0]?.planType as PlanTypeLiteral) ?? 'FREE';

  // 公開中 (isPublished + READY + 期間内) の動画のみ。
  // プランでは絞らない — 無料プランにもサムネイルは見せ、再生だけを止める。
  const now = new Date();
  const videos = await prisma.video.findMany({
    where: listableVideoWhere(now),
    orderBy: { publishedAt: 'desc' },
    take: 60,
    select: {
      id: true,
      title: true,
      description: true,
      thumbnailUrl: true,
      durationSeconds: true,
      accessLevel: true,
      status: true,
      isPublished: true,
      publishedAt: true,
      expiresAt: true,
    },
  });

  // サムネイルは非公開バケット上の S3 キーなので署名が必要。
  // S3 プリサインドは非同期なので、描画前に一括で並列解決しておく
  // (map の中で await できないため)。
  const thumbnailUrls = await resolveThumbnailUrls(videos.map((v) => v.thumbnailUrl));

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">動画</h1>
        <Link href="/me" className="text-sm text-brand-600 hover:underline">
          マイページへ
        </Link>
      </div>

      {videos.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-slate-500">
            公開中の動画はありません
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v, i) => {
            const locked = !isVideoPlayable(
              {
                isPublished: v.isPublished,
                status: v.status,
                publishedAt: v.publishedAt,
                expiresAt: v.expiresAt,
                accessLevel: v.accessLevel,
              },
              plan,
              now,
            );
            const thumbnailUrl = thumbnailUrls[i] ?? null;
            return (
              <Link
                key={v.id}
                href={`/me/videos/${v.id}`}
                className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
              >
                <div className="relative aspect-video w-full bg-slate-100">
                  {thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-100 to-brand-50 text-brand-400">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M8 5v14l11-7L8 5z" fill="currentColor" />
                      </svg>
                    </div>
                  )}
                  {v.durationSeconds != null && (
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      {Math.floor(v.durationSeconds / 60)}:
                      {String(v.durationSeconds % 60).padStart(2, '0')}
                    </span>
                  )}
                  {locked && (
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      {accessLevelLabel(v.accessLevel)}
                    </span>
                  )}
                </div>
                <div className="space-y-1.5 p-3">
                  <h2 className="line-clamp-2 text-sm font-semibold text-slate-800 group-hover:text-brand-600">
                    {v.title}
                  </h2>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={v.accessLevel === 'PREMIUM' ? 'brand' : 'gray'}>
                      {accessLevelLabel(v.accessLevel)}
                    </Badge>
                    {v.publishedAt && (
                      <span className="text-[11px] text-slate-400">
                        {formatJstDate(v.publishedAt)}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
