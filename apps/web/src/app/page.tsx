import Link from 'next/link';
import { PLAN_LABELS, PLAN_PRICES } from '@idol/shared';
import { formatJpy } from '@/lib/pricing';
import { Badge } from '@/components/ui/Badge';
import { TwilightBackdrop } from '@/components/layout/TwilightBackdrop';
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
    <div className="bg-twilight-cream">
      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden text-twilight-cream">
        <TwilightBackdrop />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28 md:py-36">
          <p className="mb-4 font-serif text-xs font-semibold uppercase tracking-[0.4em] text-twilight-cream/80 sm:text-sm">
            REIRIE Official Fan Club
          </p>
          <h1 className="font-serif text-4xl font-semibold leading-tight text-glow sm:text-6xl md:text-7xl">
            ReiRieRoom
          </h1>
          <p className="mt-4 font-serif text-lg italic tracking-wide text-twilight-rose sm:text-2xl">
            Welcome to the Amethyst Room
          </p>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-twilight-cream/90 sm:text-base md:text-lg">
            ファンだけが入れる、紫水晶の部屋。
            <br className="hidden sm:inline" />
            限定コンテンツ・ライブ配信・特典会・先行チケット。
            REIRIE との特別な時間をお届けします。
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/signup"
              className="rounded-full bg-twilight-btn px-8 py-3.5 text-center font-semibold text-white shadow-lg glow-rose transition hover:opacity-95"
            >
              入室する（無料会員登録）
            </Link>
            <Link
              href="/contents"
              className="rounded-full border border-twilight-cream/40 bg-white/10 px-8 py-3.5 text-center font-semibold text-twilight-cream backdrop-blur transition hover:bg-white/20"
            >
              コンテンツを見る
            </Link>
          </div>
        </div>
      </section>

      {/* ===== 会員ランク ===== */}
      <section className="relative mx-auto max-w-6xl px-4 py-14 sm:py-20">
        <SectionHeading en="Membership" ja="会員ランク" />
        <div className="mt-8 grid gap-5 sm:gap-6 md:grid-cols-3">
          <RankCard
            rank="Crystal"
            ja="クリスタル"
            desc="まずはこちらから。お知らせと一部コンテンツを楽しめる入口の階。"
            tone="crystal"
          />
          <RankCard
            rank="Amethyst"
            ja="アメジスト"
            desc="限定コンテンツとライブ配信が解放。最も人気のスタンダードな階。"
            tone="amethyst"
            featured
          />
          <RankCard
            rank="Royal"
            ja="ロイヤル"
            desc="見逃し配信・特別動画・会員価格グッズ・特典会優先。最上階の特別な部屋。"
            tone="royal"
          />
        </div>
      </section>

      {/* ===== 最新お知らせ ===== */}
      {latestNotices.length > 0 && (
        <section className="relative mx-auto max-w-6xl px-4 pb-4 sm:pb-8">
          <div className="glass-light rounded-3xl p-6 sm:p-8">
            <div className="mb-5 flex items-baseline justify-between gap-2">
              <SectionHeading en="News" ja="最新のお知らせ" align="left" compact />
              <Link
                href="/notices"
                className="text-xs font-semibold text-twilight-amethyst transition hover:opacity-70 sm:text-sm"
              >
                すべて見る →
              </Link>
            </div>
            <ul className="divide-y divide-twilight-amethyst/15">
              {latestNotices.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/notices/${a.id}`}
                    className="flex items-start gap-3 rounded-xl px-2 py-3 transition hover:bg-twilight-amethyst/5 sm:items-center sm:gap-4"
                  >
                    <time
                      dateTime={a.publishedAt?.toISOString()}
                      className="shrink-0 font-serif text-xs font-medium tabular-nums text-twilight-amethyst sm:text-sm"
                    >
                      {formatDate(a.publishedAt)}
                    </time>
                    <p className="line-clamp-2 flex-1 text-sm text-twilight-plum sm:line-clamp-1 sm:text-base">
                      {a.title}
                    </p>
                    <span className="hidden text-twilight-amethyst/40 sm:inline" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ===== 特典 ===== */}
      <section className="relative mx-auto max-w-6xl px-4 py-14 sm:py-20">
        <SectionHeading en="Privileges" ja="会員特典" />
        <div className="mt-8 grid gap-5 sm:gap-6 md:grid-cols-3">
          <FeatureCard
            no="01"
            title="限定コンテンツ"
            description="メンバー限定の動画・写真・ブログ・ボイスをいち早くチェック。"
          />
          <FeatureCard
            no="02"
            title="ライブ配信"
            description="月1回以上のオンラインライブ。上位ランクは見逃し配信も視聴可能。"
          />
          <FeatureCard
            no="03"
            title="特典会・先行チケット"
            description="“部屋に入る”特典会や、会員限定の先行チケット受付に申し込み。"
          />
        </div>
      </section>

      {/* ===== プラン ===== */}
      <section className="relative py-14 sm:py-20">
        {/* 下部に向かう淡い Twilight グラデ */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-twilight-rose/10 to-twilight-amethyst/15" />
        <div className="relative mx-auto max-w-6xl px-4">
          <SectionHeading en="Plans" ja="会員プラン" />
          <div className="mt-8 grid gap-5 sm:gap-6 md:grid-cols-3">
            <PlanCard plan="FREE" />
            <PlanCard plan="STANDARD" highlight />
            <PlanCard plan="PREMIUM" />
          </div>
          <p className="mt-6 text-center text-xs text-twilight-plum/60">
            ※価格は税込。年額プランは2ヶ月分お得です。
          </p>
        </div>
      </section>
    </div>
  );
}

/* ===== セクション見出し ===== */
function SectionHeading({
  en,
  ja,
  align = 'center',
  compact = false,
}: {
  en: string;
  ja: string;
  align?: 'center' | 'left';
  compact?: boolean;
}) {
  return (
    <div className={align === 'center' ? 'text-center' : 'text-left'}>
      <p className="font-serif text-xs uppercase tracking-[0.35em] text-twilight-amethyst sm:text-sm">
        {en}
      </p>
      <h2
        className={`mt-1 font-bold text-twilight-plum ${
          compact ? 'text-lg sm:text-xl' : 'text-2xl sm:text-3xl'
        }`}
      >
        {ja}
      </h2>
    </div>
  );
}

/* ===== 会員ランクカード ===== */
function RankCard({
  rank,
  ja,
  desc,
  tone,
  featured,
}: {
  rank: string;
  ja: string;
  desc: string;
  tone: 'crystal' | 'amethyst' | 'royal';
  featured?: boolean;
}) {
  const accent =
    tone === 'crystal'
      ? 'from-twilight-rose to-twilight-mauve'
      : tone === 'amethyst'
        ? 'from-twilight-mauve to-twilight-amethyst'
        : 'from-twilight-amethyst to-twilight-plum';
  return (
    <div
      className={`relative overflow-hidden rounded-3xl border bg-white/70 p-6 backdrop-blur-sm transition hover:-translate-y-1 hover:shadow-xl sm:p-7 ${
        featured
          ? 'border-twilight-amethyst/40 shadow-lg ring-1 ring-twilight-amethyst/20'
          : 'border-twilight-amethyst/15 shadow-sm'
      }`}
    >
      <div className={`mb-4 h-1.5 w-12 rounded-full bg-gradient-to-r ${accent}`} />
      {featured && (
        <span className="absolute right-5 top-5">
          <Badge tone="brand">人気</Badge>
        </span>
      )}
      <h3 className="font-serif text-2xl font-semibold text-twilight-plum">{rank}</h3>
      <p className="mt-0.5 text-sm font-medium text-twilight-amethyst">{ja}</p>
      <p className="mt-3 text-sm leading-relaxed text-twilight-plum/75">{desc}</p>
    </div>
  );
}

/* ===== 特典カード ===== */
function FeatureCard({
  no,
  title,
  description,
}: {
  no: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-twilight-amethyst/15 bg-white/70 p-6 shadow-sm backdrop-blur-sm transition hover:-translate-y-1 hover:shadow-xl sm:p-7">
      <p className="font-serif text-3xl font-semibold text-twilight-rose">{no}</p>
      <h3 className="mt-3 text-lg font-semibold text-twilight-plum">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-twilight-plum/75">{description}</p>
    </div>
  );
}

/* ===== プランカード ===== */
function PlanCard({
  plan,
  highlight,
}: {
  plan: 'FREE' | 'STANDARD' | 'PREMIUM';
  highlight?: boolean;
}) {
  const price = PLAN_PRICES[plan];
  return (
    <div
      className={`flex flex-col rounded-3xl border bg-white/80 p-6 backdrop-blur-sm transition sm:p-7 ${
        highlight
          ? 'border-twilight-amethyst/40 shadow-xl ring-2 ring-twilight-amethyst/25'
          : 'border-twilight-amethyst/15 shadow-sm hover:shadow-lg'
      }`}
    >
      <div className="mb-3 flex items-center justify-center gap-2">
        <h3 className="text-xl font-bold text-twilight-plum">{PLAN_LABELS[plan]}</h3>
        {highlight && <Badge tone="brand">人気</Badge>}
      </div>
      <p className="text-center font-serif text-4xl font-semibold text-twilight-amethyst">
        {plan === 'FREE' ? '無料' : `${formatJpy(price.monthly)}`}
        {plan !== 'FREE' && <span className="text-base font-normal">/月</span>}
      </p>
      {plan !== 'FREE' && (
        <p className="text-center text-sm text-twilight-plum/60">年額 {formatJpy(price.yearly)}</p>
      )}
      <ul className="mt-6 flex-1 space-y-2.5 text-left text-sm text-twilight-plum/80">
        <li className="flex gap-2">
          <Check /> お知らせ閲覧
        </li>
        {plan !== 'FREE' && (
          <li className="flex gap-2">
            <Check /> 限定コンテンツ視聴
          </li>
        )}
        {plan !== 'FREE' && (
          <li className="flex gap-2">
            <Check /> ライブ配信視聴
          </li>
        )}
        {plan === 'PREMIUM' && (
          <li className="flex gap-2">
            <Check /> 見逃し配信・特別動画
          </li>
        )}
        {plan === 'PREMIUM' && (
          <li className="flex gap-2">
            <Check /> 会員価格でグッズ購入
          </li>
        )}
        {plan !== 'FREE' && (
          <li className="flex gap-2">
            <Check /> 先行チケット申込
          </li>
        )}
      </ul>
      <Link
        href={plan === 'FREE' ? '/signup' : '/me'}
        className={`mt-7 block rounded-full px-4 py-2.5 text-center text-sm font-semibold transition ${
          highlight
            ? 'bg-twilight-btn text-white shadow-sm hover:opacity-95'
            : 'border border-twilight-amethyst/40 text-twilight-amethyst hover:bg-twilight-amethyst/10'
        }`}
      >
        {plan === 'FREE' ? '無料登録' : 'プランを選ぶ'}
      </Link>
    </div>
  );
}

function Check() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 shrink-0 text-twilight-amethyst"
      aria-hidden="true"
    >
      <path d="M4 10.5l4 4 8-8" />
    </svg>
  );
}
