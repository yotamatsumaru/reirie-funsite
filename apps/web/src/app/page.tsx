import Link from 'next/link';
import { PLAN_LABELS, PLAN_PRICES } from '@idol/shared';
import { formatJpy } from '@/lib/pricing';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { listAnnouncements } from '@/lib/demo-store';

export const dynamic = 'force-dynamic';

function formatDate(d: Date | null): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export default async function HomePage() {
  // 最新お知らせ 3 件 (ALL 公開のみ — 未ログインユーザーも見られるもの)
  const latestNotices = listAnnouncements()
    .filter((a) => a.status === 'PUBLISHED' && a.audience === 'ALL')
    .slice(0, 3);

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 text-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-20 md:py-28">
          <p className="mb-3 text-xs font-semibold tracking-widest text-white/80 sm:mb-4 sm:text-sm">
            OFFICIAL FAN CLUB
          </p>
          <h1 className="text-2xl font-bold leading-tight sm:text-4xl md:text-5xl">
            アイドルとファンを繋ぐ
            <br className="hidden sm:inline" />
            <span className="sm:hidden"> </span>
            公式コミュニティへようこそ
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-white/90 sm:mt-6 sm:text-base md:text-lg">
            限定コンテンツ・ライブ配信・先行チケット・公式グッズ。
            <br className="hidden sm:inline" />
            プレミアム会員ならではの特別な体験をお届けします。
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">
            <Link
              href="/signup"
              className="rounded-lg bg-white px-6 py-3 text-center font-semibold text-brand-700 shadow hover:bg-brand-50"
            >
              無料会員登録
            </Link>
            <Link
              href="/contents"
              className="rounded-lg border border-white/40 bg-white/10 px-6 py-3 text-center font-semibold text-white hover:bg-white/20"
            >
              コンテンツを見る
            </Link>
          </div>
        </div>
      </section>

      {/* 最新お知らせ */}
      {latestNotices.length > 0 && (
        <section className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
            <div className="mb-4 flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold text-slate-800 sm:text-xl">
                📣 最新のお知らせ
              </h2>
              <Link
                href="/notices"
                className="text-xs font-semibold text-brand-600 hover:underline sm:text-sm"
              >
                すべて見る →
              </Link>
            </div>
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {latestNotices.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/notices/${a.id}`}
                    className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50 sm:items-center sm:gap-4 sm:px-5 sm:py-3.5"
                  >
                    <time
                      dateTime={a.publishedAt?.toISOString()}
                      className="shrink-0 text-xs font-medium tabular-nums text-slate-500 sm:text-sm"
                    >
                      {formatDate(a.publishedAt)}
                    </time>
                    <p className="line-clamp-2 flex-1 text-sm text-slate-800 sm:line-clamp-1 sm:text-base">
                      {a.title}
                    </p>
                    <span className="hidden text-slate-300 sm:inline" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* 特典 */}
      <section className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
        <h2 className="mb-6 text-xl font-bold text-slate-800 sm:mb-8 sm:text-2xl">会員特典</h2>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
          <FeatureCard
            title="限定コンテンツ"
            description="メンバー限定の動画・写真・ブログをいち早くチェック"
          />
          <FeatureCard
            title="ライブ配信"
            description="月1回以上のオンラインライブ。プレミアム会員は見逃し配信も視聴可能"
          />
          <FeatureCard
            title="先行チケット"
            description="ローソンチケット連携で会員限定先行受付に申し込み"
          />
        </div>
      </section>

      {/* プラン */}
      <section className="bg-white py-10 sm:py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-6 text-xl font-bold text-slate-800 sm:mb-8 sm:text-2xl">会員プラン</h2>
          <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
            <PlanCard plan="FREE" />
            <PlanCard plan="STANDARD" highlight />
            <PlanCard plan="PREMIUM" />
          </div>
          <p className="mt-6 text-center text-xs text-slate-500">
            ※価格は税込。年額プランは2ヶ月分お得です。
          </p>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardBody>
        <h3 className="mb-2 text-lg font-semibold text-slate-800">{title}</h3>
        <p className="text-sm leading-relaxed text-slate-600">{description}</p>
      </CardBody>
    </Card>
  );
}

function PlanCard({
  plan,
  highlight,
}: {
  plan: 'FREE' | 'STANDARD' | 'PREMIUM';
  highlight?: boolean;
}) {
  const price = PLAN_PRICES[plan];
  return (
    <Card className={highlight ? 'border-brand-500 ring-2 ring-brand-200' : ''}>
      <CardBody className="text-center">
        <div className="mb-3 flex items-center justify-center gap-2">
          <h3 className="text-xl font-bold text-slate-800">{PLAN_LABELS[plan]}</h3>
          {highlight && <Badge tone="brand">人気</Badge>}
        </div>
        <p className="mb-1 text-3xl font-bold text-brand-600">
          {plan === 'FREE' ? '無料' : `${formatJpy(price.monthly)}/月`}
        </p>
        {plan !== 'FREE' && (
          <p className="text-sm text-slate-500">年額 {formatJpy(price.yearly)}</p>
        )}
        <ul className="mt-6 space-y-2 text-left text-sm text-slate-600">
          <li>✓ お知らせ閲覧</li>
          {plan !== 'FREE' && <li>✓ 限定コンテンツ視聴</li>}
          {plan !== 'FREE' && <li>✓ ライブ配信視聴</li>}
          {plan === 'PREMIUM' && <li>✓ 見逃し配信・特別動画</li>}
          {plan === 'PREMIUM' && <li>✓ 会員価格(プレミアム)でグッズ購入</li>}
          {plan !== 'FREE' && <li>✓ 先行チケット申込</li>}
        </ul>
        <Link
          href={plan === 'FREE' ? '/signup' : '/me'}
          className={`mt-6 block rounded-md px-4 py-2 text-sm font-semibold ${
            highlight
              ? 'bg-brand-600 text-white hover:bg-brand-700'
              : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          {plan === 'FREE' ? '無料登録' : 'プランを選ぶ'}
        </Link>
      </CardBody>
    </Card>
  );
}
