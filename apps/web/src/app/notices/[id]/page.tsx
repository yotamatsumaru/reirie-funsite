/**
 * /notices/[id] — お知らせ詳細
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/auth';
import { getAnnouncement } from '@/lib/demo-store';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const dynamic = 'force-dynamic';

const AUDIENCE_LABELS = {
  ALL: '全員',
  MEMBERS: '会員',
  PREMIUM: 'PREMIUM',
} as const;

const AUDIENCE_TONES = {
  ALL: 'info',
  MEMBERS: 'brand',
  PREMIUM: 'warning',
} as const;

function formatDateTime(d: Date | null): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const a = getAnnouncement(id);
  if (!a) return { title: 'お知らせ' };
  return {
    title: a.title,
    description: a.body.slice(0, 120),
  };
}

export default async function NoticeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const a = getAnnouncement(id);

  if (!a || a.status !== 'PUBLISHED') {
    notFound();
  }

  const session = await auth();
  const userPlan = session?.user?.plan ?? 'FREE';
  const isLoggedIn = !!session?.user?.id;

  // 閲覧制限
  if (a.audience === 'MEMBERS' && !isLoggedIn) {
    redirect(`/signin?callbackUrl=/notices/${id}`);
  }
  if (a.audience === 'PREMIUM' && userPlan !== 'PREMIUM') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <Link
          href="/notices"
          className="text-sm text-brand-600 hover:underline"
        >
          ← お知らせ一覧に戻る
        </Link>
        <Card className="mt-4 border-amber-200 bg-amber-50/50">
          <CardBody className="text-center">
            <p className="text-5xl">🔒</p>
            <h1 className="mt-3 text-xl font-bold text-slate-900">
              このお知らせは PREMIUM 会員限定です
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              PREMIUM プランにアップグレードすると、限定お知らせを閲覧できます。
            </p>
            <Link
              href="/plans"
              className="mt-6 inline-block rounded-md bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              プランを見る
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <Link
        href="/notices"
        className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
      >
        ← お知らせ一覧に戻る
      </Link>

      <article className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <time
            dateTime={a.publishedAt?.toISOString()}
            className="text-sm tabular-nums text-slate-500"
          >
            {formatDateTime(a.publishedAt)}
          </time>
          <Badge tone={AUDIENCE_TONES[a.audience]}>
            {AUDIENCE_LABELS[a.audience]}
          </Badge>
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-tight text-slate-900 sm:text-3xl">
          {a.title}
        </h1>

        <Card className="mt-6">
          <CardBody>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 sm:text-base">
              {a.body}
            </div>
          </CardBody>
        </Card>
      </article>
    </div>
  );
}
