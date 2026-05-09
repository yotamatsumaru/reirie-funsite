import Link from 'next/link';
import { PLAN_LABELS, PLAN_PRICES } from '@idol/shared';
import { formatJpy } from '@/lib/pricing';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
          <p className="mb-4 text-sm font-semibold tracking-widest text-white/80">
            OFFICIAL FAN CLUB
          </p>
          <h1 className="text-4xl font-bold leading-tight md:text-5xl">
            アイドルとファンを繋ぐ
            <br />
            公式コミュニティへようこそ
          </h1>
          <p className="mt-6 max-w-2xl text-base text-white/90 md:text-lg">
            限定コンテンツ・ライブ配信・先行チケット・公式グッズ。
            <br />
            プレミアム会員ならではの特別な体験をお届けします。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-white px-6 py-3 font-semibold text-brand-700 shadow hover:bg-brand-50"
            >
              無料会員登録
            </Link>
            <Link
              href="/contents"
              className="rounded-lg border border-white/40 bg-white/10 px-6 py-3 font-semibold text-white hover:bg-white/20"
            >
              コンテンツを見る
            </Link>
          </div>
        </div>
      </section>

      {/* 特典 */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="mb-8 text-2xl font-bold text-slate-800">会員特典</h2>
        <div className="grid gap-6 md:grid-cols-3">
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
      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-8 text-2xl font-bold text-slate-800">会員プラン</h2>
          <div className="grid gap-6 md:grid-cols-3">
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
