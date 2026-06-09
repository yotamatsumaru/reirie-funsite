import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { canAccess } from '@idol/shared';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'コンテンツ' };
export const dynamic = 'force-dynamic';

export default async function ContentsPage() {
  const session = await auth();
  const plan = session?.user?.plan;

  const allowed: Array<'PUBLIC' | 'MEMBERS' | 'PREMIUM'> = ['PUBLIC'];
  if (canAccess(plan, 'MEMBERS')) allowed.push('MEMBERS');
  if (canAccess(plan, 'PREMIUM')) allowed.push('PREMIUM');

  const items = await prisma.content.findMany({
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
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">コンテンツ</h1>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">公開されているコンテンツはありません</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Link key={c.id} href={`/contents/${c.slug}`}>
              <Card className="transition-shadow hover:shadow-md">
                {c.coverImageUrl && (
                  <div className="aspect-video w-full overflow-hidden rounded-t-lg bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.coverImageUrl}
                      alt={c.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                <CardBody>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge tone="gray">{c.type}</Badge>
                    {c.accessLevel === 'PREMIUM' && <Badge tone="brand">PREMIUM</Badge>}
                    {c.accessLevel === 'MEMBERS' && <Badge tone="info">MEMBERS</Badge>}
                  </div>
                  <h2 className="mb-1 line-clamp-2 text-base font-semibold text-slate-800">
                    {c.title}
                  </h2>
                  {c.excerpt && (
                    <p className="line-clamp-2 text-sm text-slate-500">{c.excerpt}</p>
                  )}
                  {c.publishedAt && (
                    <p className="mt-2 text-xs text-slate-400">
                      {new Date(c.publishedAt).toLocaleDateString('ja-JP')}
                    </p>
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
