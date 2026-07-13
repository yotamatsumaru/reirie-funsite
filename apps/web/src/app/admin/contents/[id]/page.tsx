import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { requireCapabilityPage } from '@/auth';
import { ContentForm, type ContentInitial } from '../content-form';

export const metadata: Metadata = { title: 'コンテンツ編集' };
export const dynamic = 'force-dynamic';

export default async function EditContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapabilityPage('CONTENT');
  const { id } = await params;

  const content = await prisma.content.findUnique({ where: { id } });
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
  };

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/admin/contents"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← コンテンツ管理へ戻る
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-800 sm:text-2xl">
          コンテンツ編集
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          閲覧数 {content.viewCount.toLocaleString()} 回 ・ 最終更新{' '}
          {new Date(content.updatedAt).toLocaleString('ja-JP')}
        </p>
      </div>

      <ContentForm mode="edit" initial={initial} />
    </div>
  );
}
