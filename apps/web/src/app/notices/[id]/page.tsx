/**
 * /notices/[id] — お知らせ詳細
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { PencilLine } from 'lucide-react';
import { auth } from '@/auth';
import { getAnnouncement } from '@/lib/announcements';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { LinkifiedText } from '@/components/ui/LinkifiedText';
import { env } from '@/lib/env';
import { resolveAnnouncementVisibility } from '@/lib/announcement-visibility';

export const dynamic = 'force-dynamic';

const AUDIENCE_LABELS: Record<'ALL' | 'MEMBERS' | 'PREMIUM', string> = {
  ALL: '全員',
  MEMBERS: '会員',
  PREMIUM: 'PREMIUM',
};

const AUDIENCE_TONES: Record<
  'ALL' | 'MEMBERS' | 'PREMIUM',
  'gray' | 'brand' | 'success' | 'warning' | 'danger' | 'info'
> = {
  ALL: 'info',
  MEMBERS: 'brand',
  PREMIUM: 'warning',
};

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
  const a = await getAnnouncement(id);
  if (!a) return { title: 'お知らせ' };

  // ⚠️ 下書きのタイトル / 本文を meta に出さないこと。
  //    generateMetadata は本文の描画とは別に実行されるため、
  //    ここに status チェックが無いと「ページは 404 なのに
  //    <title> と og:description に下書きの内容が出る」という
  //    情報漏洩になる (SNS のリンクプレビューにも出てしまう)。
  if (a.status !== 'PUBLISHED') {
    return { title: 'お知らせ', robots: { index: false, follow: false } };
  }

  return {
    title: a.title,
    description: a.body.slice(0, 120),
    // 会員限定は検索エンジンにインデックスさせない
    ...(a.audience === 'ALL'
      ? {}
      : { robots: { index: false, follow: false } }),
  };
}

export default async function NoticeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { id } = await params;
  const { preview } = await searchParams;
  const a = await getAnnouncement(id);

  if (!a) {
    notFound();
  }

  const session = await auth();

  // 閲覧可否は純粋関数に集約 (lib/announcement-visibility.ts)。
  // 下書きは運営 (SUPER_ADMIN / STAFF) が ?preview=1 を付けたときのみ表示され、
  // それ以外の全員には 404 になる。
  const decision = resolveAnnouncementVisibility(
    { status: a.status, audience: a.audience },
    {
      isLoggedIn: !!session?.user?.id,
      role: session?.user?.role,
      plan: session?.user?.plan,
    },
    preview === '1',
  );

  if (decision.kind === 'not-found') {
    notFound();
  }
  if (decision.kind === 'signin-required') {
    redirect(`/signin?callbackUrl=/notices/${id}`);
  }

  const isPreview = decision.kind === 'preview';

  if (decision.kind === 'upgrade-required') {
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
      {/*
        下書きプレビュー時の警告バナー。
        「今見ているものは公開されていない」ことを一目で分かるようにして、
        公開済みと勘違いする事故を防ぐ。
      */}
      {isPreview && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          {/*
            アイコンは絵文字 (👁️) ではなく lucide-react を使う。
            絵文字は OS / ブラウザごとに字形も色も変わって浮くため、
            管理画面 (super-admin/layout.tsx) と同じ lucide に統一する。

            PencilLine を選んだ理由:
              - FilePen は 18px だとペン先と書類の枠線が重なって潰れる
                (実際に拡大して確認した)
              - 「目」より「鉛筆」の方が "下書き / 書きかけ" の意味に合う
            単色の線画なので amber 系の文字色をそのまま継承できる。
          */}
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-200/70 text-amber-800"
          >
            <PencilLine className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900">
              下書きプレビュー（まだ公開されていません）
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">
              この画面は運営 (SUPER_ADMIN / STAFF) だけに表示されています。
              他の方がこの URL を開いても「ページが見つかりません」になります。
              <br />
              公開するには{' '}
              <Link
                href="/super-admin/announcements"
                className="font-semibold underline hover:no-underline"
              >
                お知らせ配信画面
              </Link>{' '}
              の「公開」ボタンを押してください。
            </p>
          </div>
        </div>
      )}

      <Link
        href={isPreview ? '/super-admin/announcements' : '/notices'}
        className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
      >
        ← {isPreview ? 'お知らせ配信画面に戻る' : 'お知らせ一覧に戻る'}
      </Link>

      <article className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          {/*
            下書きは publishedAt が null なので、日付の代わりに
            「未公開」であることを示す (空欄だと崩れて見える)。
          */}
          {a.publishedAt ? (
            <time
              dateTime={a.publishedAt.toISOString()}
              className="text-sm tabular-nums text-slate-500"
            >
              {formatDateTime(a.publishedAt)}
            </time>
          ) : (
            <span className="text-sm text-slate-400">日付未定（未公開）</span>
          )}
          {isPreview && <Badge tone="warning">下書き</Badge>}
          <Badge tone={AUDIENCE_TONES[a.audience]}>
            {AUDIENCE_LABELS[a.audience]}
          </Badge>
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-tight text-slate-900 sm:text-3xl">
          {a.title}
        </h1>

        <Card className="mt-6">
          <CardBody>
            {/*
              本文はプレーンテキスト。URL / メールアドレスは
              LinkifiedText が自動でリンク化する
              (dangerouslySetInnerHTML は使わないので XSS の心配は無い)。
            */}
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 sm:text-base">
              <LinkifiedText text={a.body} selfOrigin={env.appBaseUrl} />
            </div>
          </CardBody>
        </Card>
      </article>
    </div>
  );
}
