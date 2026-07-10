import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { canAccess } from '@idol/shared';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody } from '@/components/ui/Card';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const c = await prisma.content.findUnique({
    where: { slug },
    select: { title: true, excerpt: true },
  });
  return { title: c?.title ?? 'コンテンツ', description: c?.excerpt ?? undefined };
}

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();

  const content = await prisma.content.findUnique({
    where: { slug },
    include: { images: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!content || content.status !== 'PUBLISHED') notFound();

  const canView = canAccess(session?.user?.plan, content.accessLevel);

  return (
    <article className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="gray">{content.type}</Badge>
        {content.accessLevel === 'PREMIUM' && <Badge tone="brand">PREMIUM</Badge>}
        {content.accessLevel === 'MEMBERS' && <Badge tone="info">MEMBERS</Badge>}
      </div>
      <h1 className="text-2xl font-bold leading-snug text-slate-800 sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-xs text-slate-500 sm:text-sm">
        {content.publishedAt
          ? new Date(content.publishedAt).toLocaleDateString('ja-JP')
          : ''}
        {content.authorName ? ` ・ ${content.authorName}` : ''}
      </p>

      {content.coverImageUrl && (
        <div className="mt-6 aspect-video w-full overflow-hidden rounded-lg bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={content.coverImageUrl} alt={content.title} className="h-full w-full object-cover" />
        </div>
      )}

      {!canView ? (
        <Card className="mt-8 border-brand-200 bg-brand-50">
          <CardBody className="text-center">
            <p className="mb-3 text-base font-semibold text-brand-700">
              このコンテンツは
              {content.accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード'}
              会員限定です
            </p>
            <p className="mb-4 text-sm text-slate-600">
              プランをアップグレードすると閲覧できます。
            </p>
            <Link
              href={session?.user ? '/me' : '/signin?callbackUrl=/me'}
              className="inline-block rounded-md bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {session?.user ? 'プランを変更する' : 'ログイン / 登録'}
            </Link>
          </CardBody>
        </Card>
      ) : (
        <>
          {content.excerpt && (
            <p className="mt-6 rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {content.excerpt}
            </p>
          )}
          <div
            className="prose prose-slate mt-8 max-w-none text-slate-800"
            // 管理API (POST/PATCH /api/admin/contents) の書き込み時に
            // sanitizeContentBody() でサニタイズ済みの HTML (RBAC + サニタイズの多層防御)
            dangerouslySetInnerHTML={{ __html: content.body ?? '' }}
          />
        </>
      )}
    </article>
  );
}
