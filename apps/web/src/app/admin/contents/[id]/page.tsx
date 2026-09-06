import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { requireCapabilityPage } from '@/auth';
import { ContentForm, type ContentInitial } from '../content-form';
import { formatJstDateTime } from '@idol/shared';

// title は種別 (ブログ / ギャラリー) で変わるが、
// generateMetadata を足すと DB を 2 回読むことになるので
// 汎用の文言にしておく。画面の見出しは種別に応じて出し分ける。
export const metadata: Metadata = { title: '記事・ギャラリー編集' };
export const dynamic = 'force-dynamic';

export default async function EditContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapabilityPage('CONTENT');
  const { id } = await params;

  const content = await prisma.content.findUnique({
    where: { id },
    // ギャラリー写真も読み込む。これが無いと編集画面を開いた時点で
    // 写真が空として扱われ、保存すると既存の写真が全部消える
    // (フォームは type=GALLERY のとき常に imageUrls を送るため)。
    include: { images: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!content) notFound();

  const initial: ContentInitial = {
    id: content.id,
    type: content.type as ContentInitial['type'],
    slug: content.slug,
    title: content.title,
    excerpt: content.excerpt ?? '',
    body: content.body,
    coverImageUrl: content.coverImageUrl ?? '',
    accessLevel: content.accessLevel as ContentInitial['accessLevel'],
    status: content.status as ContentInitial['status'],
    authorName: content.authorName ?? '',
    tags: content.tags,
    galleryImages: content.images.map((img) => ({
      url: img.url,
      caption: img.caption ?? '',
    })),
  };

  const isGallery = content.type === 'GALLERY';
  const kindLabel = isGallery ? 'ギャラリー' : 'ブログ';

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/admin/contents"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← ブログ・ギャラリー管理へ戻る
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-800 sm:text-2xl">
          {kindLabel}編集
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          閲覧数 {content.viewCount.toLocaleString()} 回
          {isGallery && ` ・ 写真 ${content.images.length} 枚`} ・ 最終更新{' '}
          {formatJstDateTime(content.updatedAt)}
        </p>
      </div>

      <ContentForm mode="edit" initial={initial} />
    </div>
  );
}
