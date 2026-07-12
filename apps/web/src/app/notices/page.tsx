/**
 * /notices — お知らせ一覧 (公開ページ)
 *
 * - PUBLISHED ステータスのお知らせのみ表示
 * - audience に応じて閲覧制限:
 *   - ALL      → 誰でも閲覧可
 *   - MEMBERS  → ログインユーザーのみ
 *   - PREMIUM  → PREMIUM プランのみ
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { auth } from '@/auth';
import { listAnnouncements } from '@/lib/announcements';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = {
  title: 'お知らせ一覧',
  description: '公式お知らせ・最新情報',
};
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

function formatDate(d: Date | null): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export default async function NoticesIndexPage() {
  const session = await auth();
  const userPlan = session?.user?.plan ?? 'FREE';
  const isLoggedIn = !!session?.user?.id;

  // PUBLISHED のみ、新しい順
  const all = (await listAnnouncements()).filter((a) => a.status === 'PUBLISHED');

  // 閲覧可否のフィルタリング
  const visible = all.filter((a) => {
    if (a.audience === 'ALL') return true;
    if (a.audience === 'MEMBERS') return isLoggedIn;
    if (a.audience === 'PREMIUM') return userPlan === 'PREMIUM';
    return false;
  });

  const hidden = all.length - visible.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          📣 お知らせ
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          公式運営からの最新情報をお届けします。
        </p>
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-center text-sm text-slate-500">
              現在公開中のお知らせはありません
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((a) => (
            <li key={a.id}>
              <Link
                href={`/notices/${a.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm sm:p-5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <time
                    dateTime={a.publishedAt?.toISOString()}
                    className="text-xs font-medium tabular-nums text-slate-500"
                  >
                    {formatDate(a.publishedAt)}
                  </time>
                  <Badge tone={AUDIENCE_TONES[a.audience]}>
                    {AUDIENCE_LABELS[a.audience]}
                  </Badge>
                </div>
                <h2 className="mt-2 text-base font-semibold text-slate-900 sm:text-lg">
                  {a.title}
                </h2>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                  {a.body}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 && (
        <Card className="mt-6 border-dashed">
          <CardBody>
            <p className="text-sm text-slate-600">
              🔒 会員限定・プレミアム限定のお知らせが{' '}
              <span className="font-semibold">{hidden} 件</span>{' '}
              非表示になっています。
              <br className="sm:hidden" />
              {!isLoggedIn ? (
                <>
                  <Link
                    href="/signin?callbackUrl=/notices"
                    className="text-brand-600 underline-offset-2 hover:underline"
                  >
                    ログイン
                  </Link>
                  または
                  <Link
                    href="/signup"
                    className="text-brand-600 underline-offset-2 hover:underline"
                  >
                    会員登録
                  </Link>
                  すると閲覧できます。
                </>
              ) : userPlan !== 'PREMIUM' ? (
                <>
                  <Link
                    href="/plans"
                    className="text-brand-600 underline-offset-2 hover:underline"
                  >
                    PREMIUM プラン
                  </Link>
                  にアップグレードすると全て閲覧できます。
                </>
              ) : null}
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
