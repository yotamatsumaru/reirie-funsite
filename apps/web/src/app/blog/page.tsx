/**
 * ブログ一覧（記事のみ）
 *
 * ## メニュー構成
 *
 * かつてサイドバーは「コンテンツ」を親とし、その下にブログ / 動画を
 * 入れ子にしていたが、以下の理由で親を廃止して並列にした。
 *
 *   - ブログを開くのに「コンテンツを展開 → ブログ」の 2 クリックが必要だった
 *   - 親の /contents は記事 + 動画の混合一覧で、子と内容が重複していた
 *
 * 現在の構成:
 *
 *   ブログ (/blog)      … 記事のみ  ← このページ
 *   動画   (/me/videos) … 動画のみ
 *
 * /contents （記事 + 動画の混合一覧）はナビから外したが、ルートは残している。
 * 記事詳細が /contents/[slug] であり、共有済み URL を壊せないため。
 *
 * `/contents?type=blog` というクエリ方式は採らなかった。アクティブ判定のために
 * サイドバー（= ルートレイアウト）で useSearchParams() を呼ぶ必要が生じ、
 * サイドバーが全ページに入っている都合で静的プリレンダリングが全滅するため
 * （`useSearchParams() should be wrapped in a suspense boundary` でビルド失敗）。
 *
 * ## 表示範囲
 *
 * ContentType.BLOG のみ、status=PUBLISHED、かつ accessLevel が自分のプランで
 * 見られるものだけ。この絞り込み方は /contents の記事側と完全に同じで、挙動を変えない。
 * (contentsVisible が OFF のときは /contents と同様に 404 にする)
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

export const metadata: Metadata = { title: 'ブログ' };
export const dynamic = 'force-dynamic';

export default async function BlogPage() {
  const { contentsVisible } = await getSiteSectionVisibility();
  if (!contentsVisible) notFound();

  const session = await auth();
  const plan = (session?.user?.plan as PlanTypeLiteral | undefined) ?? undefined;

  // 公開範囲の段階を追加したときにここの列挙を直し忘れると、
  // その段階のコンテンツが誰にも表示されなくなるので共通関数から導出する。
  const allowed = accessibleLevels(plan);

  const posts = await prisma.content.findMany({
    where: { status: 'PUBLISHED', type: 'BLOG', accessLevel: { in: allowed } },
    orderBy: { publishedAt: 'desc' },
    take: 48,
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      coverImageUrl: true,
      accessLevel: true,
      publishedAt: true,
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">ブログ</h1>
        {/* 「コンテンツをすべて見る」(/contents) は廃止し、もう一方の
            並列メニューである動画へ渡す導線にした。
            ナビから外したページへ本文から誘導すると、
            サイドバーに無いページに迷い込むことになるため。 */}
        <Link href="/me/videos" className="text-sm font-semibold text-brand-600 hover:underline">
          動画を見る →
        </Link>
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-slate-500">公開されているブログはありません</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <Link key={p.id} href={`/contents/${p.slug}`}>
              <Card className="transition-shadow hover:shadow-md">
                <div className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-slate-100">
                  {p.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.coverImageUrl}
                      alt={p.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-100 to-brand-50 text-brand-400">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M6 4h9l5 5v11a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1z"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                      </svg>
                    </div>
                  )}
                </div>
                <CardBody>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge tone="gray">ブログ</Badge>
                    {/* 生の enum 名 (PREMIUM/MEMBERS) をそのまま出していたため、
                        公開範囲を増やしても新しい段階のバッジが出なかった。
                        PUBLIC 以外は共通ラベルでバッジを出す。 */}
                    {p.accessLevel !== 'PUBLIC' && (
                      <Badge tone={p.accessLevel === 'PREMIUM' ? 'brand' : 'info'}>
                        {accessLevelLabel(p.accessLevel)}
                      </Badge>
                    )}
                  </div>
                  <h2 className="mb-1 line-clamp-2 text-base font-semibold text-slate-800">
                    {p.title}
                  </h2>
                  {p.excerpt && <p className="line-clamp-2 text-sm text-slate-500">{p.excerpt}</p>}
                  {p.publishedAt && (
                    <p className="mt-2 text-xs text-slate-400">{formatJstDate(p.publishedAt)}</p>
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
