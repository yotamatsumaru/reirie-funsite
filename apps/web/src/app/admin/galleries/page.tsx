/**
 * ギャラリー（ライブ写真などの写真まとめ）の管理一覧。
 *
 * ## なぜブログと別ページなのか
 *
 * データ上はどちらも `contents` テーブルの `type` 違いだが、
 * 運営の作業としては「ブログを書く」と「ライブ写真を上げる」は別物。
 * 混在した一覧だと種別バッジを目で追う必要があり、
 * さらにギャラリーには「写真の枚数」という固有の情報がある。
 *
 * 編集画面 (`/admin/contents/[id]`) は共通のまま使う。
 * 同じフォームで種別を切り替えられる作りなので、
 * 編集画面まで二重化すると保守が倍になる。
 *
 * ## ルーティング
 *
 *   /admin/contents            … ブログ一覧
 *   /admin/galleries           … ギャラリー一覧  ← このページ
 *   /admin/contents/new?type=  … 新規作成 (種別を初期選択)
 *   /admin/contents/[id]       … 編集 (共通)
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { requireCapabilityPage } from '@/auth';
import { AdminContentList } from '../contents/content-list';

export const metadata: Metadata = { title: 'ギャラリー管理' };
export const dynamic = 'force-dynamic';

export default async function AdminGalleriesPage() {
  await requireCapabilityPage('CONTENT');

  const items = await prisma.content.findMany({
    where: { type: 'GALLERY' },
    /**
     * アルバムごとにまとめてから更新日順に並べる。
     *
     * 更新日だけで並べると、同じアルバムのギャラリーが
     * 一覧のあちこちに散り、「このアルバムに何が入っているか」を
     * 確認しにくい。nulls last にするのは未設定を末尾に寄せるためで、
     * 会員側の一覧 (「その他」が末尾) と順番を揃える意図もある。
     */
    orderBy: [{ album: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
    take: 50,
    select: {
      id: true,
      title: true,
      status: true,
      accessLevel: true,
      publishedAt: true,
      updatedAt: true,
      viewCount: true,
      album: true,
      // 一覧に「写真 N 枚」を出すため。
      // images を実体で取ると 50 件 × 最大 60 枚を読むことになるので
      // 件数だけ数える。
      _count: { select: { images: true } },
    },
  });

  const rows = items.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    accessLevel: c.accessLevel,
    publishedAt: c.publishedAt,
    updatedAt: c.updatedAt,
    viewCount: c.viewCount,
    imageCount: c._count.images,
    album: c.album,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">ギャラリー管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            ライブ写真などをまとめて公開できます。記事を書く場合は
            <Link href="/admin/contents" className="ml-1 text-brand-600 hover:underline">
              ブログ管理
            </Link>
            をご利用ください。
          </p>
        </div>
        {/* 種別を GALLERY に固定して渡す。
            これが無いと新規作成が既定のブログで開き、
            «写真を上げようとしたのに写真欄が出ない» となる。 */}
        <Link
          href="/admin/contents/new?type=GALLERY"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + ギャラリーを作る
        </Link>
      </div>

      <AdminContentList items={rows} kind="GALLERY" />
    </div>
  );
}
