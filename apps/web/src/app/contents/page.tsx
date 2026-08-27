/**
 * コンテンツ一覧（ブログ / ギャラリー / 動画）
 *
 * ## 動画を混ぜている理由（重要）
 *
 * 以前このページは `prisma.content` だけを見ていたため、動画をアップロードしても
 * 「公開されているコンテンツはありません」のままだった。動画は `content` ではなく
 * `video` テーブルに入るので、いくら動画を追加しても表示されなかった。
 * サイドバーの「動画」への導線も無かったため、会員は動画に到達できなかった。
 *
 * そこで **両方を取得してマージ** し、公開日時で並べて 1 つの一覧として見せる。
 *
 * ## 無料プランでもサムネイルは見せる
 *
 * 動画は「一覧に出すか」と「再生できるか」を分離している（lib/video-visibility.ts）。
 * 一覧はプランで絞り込まず、再生できないものには鍵バッジを付けて表示する。
 * 実際の再生ガードは詳細ページと `/api/videos/[id]/playback` 側で行う。
 * （記事側は従来どおり accessLevel で絞り込む。挙動を変えないため）
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { accessLevelLabel, accessibleLevels, formatJstDate, type PlanTypeLiteral } from '@idol/shared';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { getSiteSectionVisibility } from '@/lib/app-setting';
import { resolveThumbnailUrls } from '@/lib/video-delivery';
import { listableVideoWhere, isVideoPlayable } from '@/lib/video-visibility';

export const metadata: Metadata = { title: 'コンテンツ' };
export const dynamic = 'force-dynamic';

/** 一覧に並べる項目（記事と動画を同じ形に正規化する） */
type FeedItem = {
  key: string;
  href: string;
  title: string;
  excerpt: string | null;
  thumbnailUrl: string | null;
  accessLevel: string;
  publishedAt: Date | null;
  kindLabel: string;
  /** 動画のみ: 再生できないので鍵表示にする */
  locked: boolean;
  /** 動画のみ: 尺（秒） */
  durationSeconds: number | null;
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default async function ContentsPage() {
  const { contentsVisible } = await getSiteSectionVisibility();
  if (!contentsVisible) notFound();

  const session = await auth();
  const plan = (session?.user?.plan as PlanTypeLiteral | undefined) ?? undefined;

  // 公開範囲の段階を追加したときにここの列挙を直し忘れると、
  // その段階のコンテンツが誰にも表示されなくなるので共通関数から導出する。
  const allowed = accessibleLevels(plan);

  const now = new Date();

  const [contents, videos] = await Promise.all([
    prisma.content.findMany({
      where: { status: 'PUBLISHED', accessLevel: { in: allowed } },
      orderBy: { publishedAt: 'desc' },
      take: 24,
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        type: true,
        coverImageUrl: true,
        accessLevel: true,
        publishedAt: true,
      },
    }),
    // 動画はプランで絞らない（無料プランにもサムネイルを見せるため）
    prisma.video.findMany({
      where: listableVideoWhere(now),
      orderBy: { publishedAt: 'desc' },
      take: 24,
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
    }),
  ]);

  // 動画サムネイルは非公開バケット上の S3 キーなので署名が必要。
  // S3 プリサインドは非同期なので map の外で一括並列解決する。
  const videoThumbs = await resolveThumbnailUrls(videos.map((v) => v.thumbnailUrl));

  const items: FeedItem[] = [
    ...contents.map((c) => ({
      key: `content:${c.id}`,
      href: `/contents/${c.slug}`,
      title: c.title,
      excerpt: c.excerpt,
      thumbnailUrl: c.coverImageUrl,
      accessLevel: c.accessLevel,
      publishedAt: c.publishedAt,
      kindLabel: c.type === 'BLOG' ? 'ブログ' : 'ギャラリー',
      locked: false,
      durationSeconds: null,
    })),
    ...videos.map((v, i) => ({
      key: `video:${v.id}`,
      href: `/me/videos/${v.id}`,
      title: v.title,
      excerpt: v.description,
      thumbnailUrl: videoThumbs[i] ?? null,
      accessLevel: v.accessLevel,
      publishedAt: v.publishedAt,
      kindLabel: '動画',
      locked: !isVideoPlayable(
        {
          isPublished: v.isPublished,
          status: v.status,
          publishedAt: v.publishedAt,
          expiresAt: v.expiresAt,
          accessLevel: v.accessLevel,
        },
        plan,
        now,
      ),
      durationSeconds: v.durationSeconds,
    })),
  ].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">コンテンツ</h1>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">公開されているコンテンツはありません</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Link key={c.key} href={c.href}>
              <Card className="transition-shadow hover:shadow-md">
                <div className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-slate-100">
                  {c.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.thumbnailUrl}
                      alt={c.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-100 to-brand-50 text-brand-400">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M8 5v14l11-7L8 5z" fill="currentColor" />
                      </svg>
                    </div>
                  )}
                  {c.durationSeconds != null && (
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      {formatDuration(c.durationSeconds)}
                    </span>
                  )}
                  {/* 無料プランなどで再生できない場合は鍵を出す（サムネイル自体は見せる） */}
                  {c.locked && (
                    <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M6 10V8a6 6 0 1112 0v2m-9 0h6a3 3 0 013 3v5a3 3 0 01-3 3H9a3 3 0 01-3-3v-5a3 3 0 013-3z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                      {c.accessLevel === 'PREMIUM' ? 'プレミアム限定' : '会員限定'}
                    </span>
                  )}
                </div>
                <CardBody>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge tone="gray">{c.kindLabel}</Badge>
                    {/* 生の enum 名 (PREMIUM/MEMBERS) をそのまま出していたため、
                        公開範囲を増やしても新しい段階のバッジが出なかった。
                        PUBLIC 以外は共通ラベルでバッジを出す。 */}
                    {c.accessLevel !== 'PUBLIC' && (
                      <Badge tone={c.accessLevel === 'PREMIUM' ? 'brand' : 'info'}>
                        {accessLevelLabel(c.accessLevel)}
                      </Badge>
                    )}
                  </div>
                  <h2 className="mb-1 line-clamp-2 text-base font-semibold text-slate-800">
                    {c.title}
                  </h2>
                  {c.excerpt && <p className="line-clamp-2 text-sm text-slate-500">{c.excerpt}</p>}
                  {c.publishedAt && (
                    <p className="mt-2 text-xs text-slate-400">{formatJstDate(c.publishedAt)}</p>
                  )}
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
