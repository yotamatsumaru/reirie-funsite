/**
 * /notices — お知らせ一覧 (公開ページ)
 *
 * - PUBLISHED ステータスのお知らせのみ表示
 * - audience に応じて閲覧制限 (上位プランは常に下位向けを含む):
 *   - ALL      → だれでも
 *   - MEMBERS  → 無料会員以上 (ログインしていれば OK)
 *   - STANDARD → スタンダード会員以上
 *   - PREMIUM  → プレミアム会員のみ
 *
 * 判定は lib/announcement-audience.ts に集約してある
 * (詳細プージ / メール宛先と同じ定義を使う)。
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { auth } from '@/auth';
import { listAnnouncements } from '@/lib/announcements';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  AUDIENCE_SHORT_LABELS,
  AUDIENCE_TONES,
  planSatisfiesAudience,
  requiresSignIn,
} from '@/lib/announcement-audience';

export const metadata: Metadata = {
  title: 'お知らせ一覧',
  description: '公式お知らせ・最新情報',
};
export const dynamic = 'force-dynamic';

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

  // 閲覧可否のフィルタリング。
  // 判定をヘルパーに寄せてあるので、配信対象が増えても
  // ここを直す必要はない (= 新しい対象が一覧に出ない事故を防ぐ)。
  const visible = all.filter((a) => {
    if (requiresSignIn(a.audience) && !isLoggedIn) return false;
    return planSatisfiesAudience(a.audience, userPlan);
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
                    {AUDIENCE_SHORT_LABELS[a.audience]}
                  </Badge>
                </div>
                <h2 className="mt-2 text-base font-semibold text-slate-900 sm:text-lg">
                  {a.title}
                </h2>
                {/*
                  ここは抜粋表示。カード全体が <Link> なので、
                  本文中の URL をリンク化すると <a> の入れ子になり
                  不正な HTML になる (クリック領域も競合する)。
                  リンクとして踏めるのは詳細ページ側 (/notices/[id])。
                */}
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
