/**
 * ブログ記事の管理一覧。
 *
 * ## ギャラリーを別ページに分けた
 *
 * 以前はこのページが type を絞らず、ブログとギャラリーを混ぜて出していた。
 * しかし
 *   - 運営は「ブログを書く」「ライブ写真を上げる」を別の作業として認識する
 *   - 一覧に混在すると、種別バッジを目で追わないと目的の物が探せない
 *   - ギャラリーには「写真の枚数」という固有の列がある
 * ため、`/admin/contents` = ブログ、`/admin/galleries` = ギャラリー に分けた。
 *
 * ルート自体は `/admin/contents` のまま変えていない。
 * 管理者がブックマークしている可能性があり、URL を変えると
 * リダイレクトを用意しない限り 404 になるため。
 *
 * 一覧のテーブルは `content-list.tsx` に共通化してある
 * (両方に同じテーブルを書くと、片方だけ列を足す等のズレが起きる)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { requireCapabilityPage } from '@/auth';
import { AdminContentList } from './content-list';

export const metadata: Metadata = { title: 'ブログ管理' };
export const dynamic = 'force-dynamic';

export default async function AdminContentsPage() {
  await requireCapabilityPage('CONTENT');

  const items = await prisma.content.findMany({
    where: { type: 'BLOG' },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      status: true,
      accessLevel: true,
      publishedAt: true,
      updatedAt: true,
      viewCount: true,
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">ブログ管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            記事の作成・編集。写真をまとめて見せる場合は
            <Link href="/admin/galleries" className="ml-1 text-brand-600 hover:underline">
              ギャラリー管理
            </Link>
            をご利用ください。
          </p>
        </div>
        {/* 種別を BLOG に固定して新規作成へ渡す。
            «ブログ管理から作ったのにギャラリーになっていた» を防ぐ。 */}
        <Link
          href="/admin/contents/new?type=BLOG"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + 記事を書く
        </Link>
      </div>

      <AdminContentList items={items} kind="BLOG" />
    </div>
  );
}
