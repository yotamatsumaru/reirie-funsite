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
import { accessibleLevels, type PlanTypeLiteral } from '@idol/shared';
import { getSiteSectionVisibility } from '@/lib/app-setting';
import { BlogCard } from '@/components/blog/BlogCard';

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
      // サムネイルが無い記事は抜粋も空のことが多い。
      // その場合カードが「タイトルだけの空白」になってしまうため、
      // 本文の冒頭からテキストを起こすのに使う (lib/blog-card.ts)。
      body: true,
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
        // items-stretch にしないと、テキストカード (画像枠なし) と
        // 画像ありカードが混在したときに高さが揃わず段差になる。
        <div className="grid items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <BlogCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}
