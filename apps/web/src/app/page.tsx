import Link from 'next/link';
import Image from 'next/image';
import { PLAN_LABELS, PLAN_PRICES, PLAN_BILLING_INTERVAL } from '@idol/shared';
import { formatJpy } from '@/lib/pricing';
import { Badge } from '@/components/ui/Badge';
import { listAnnouncements } from '@/lib/announcements';
import { getSiteImageUrl } from '@/lib/site-image';
import { getSiteSectionVisibility } from '@/lib/app-setting';

export const dynamic = 'force-dynamic';

const DEFAULT_HERO_IMAGE = '/images/hero/hero-main.jpg';

// 外部URL (S3/CloudFront 等) は remotePatterns 未登録の可能性があるため
// next/image の最適化をスキップする。ローカル/相対パスはそのまま最適化する。
function isExternal(url: string): boolean {
  return /^https?:\/\//.test(url) && url !== DEFAULT_HERO_IMAGE;
}

function formatDate(d: Date | null): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export default async function HomePage() {
  // 最新お知らせ 3 件 (ALL 公開のみ — 未ログインユーザーも見られるもの)
  const latestNotices = (await listAnnouncements())
    .filter((a) => a.status === 'PUBLISHED' && a.audience === 'ALL')
    .slice(0, 3);

  // ヒーロー画像 (super-admin で差し替え可能。未設定時はデフォルト画像)
  //  - スマホ用: 縦長 (home.hero)
  //  - PC用   : 横長 (home.hero.desktop)
  // 片方が未設定の場合はもう片方にフォールバックする。
  const [heroPortraitRaw, heroLandscapeRaw] = await Promise.all([
    getSiteImageUrl('home.hero'),
    getSiteImageUrl('home.hero.desktop'),
  ]);
  const heroPortrait = heroPortraitRaw ?? heroLandscapeRaw ?? DEFAULT_HERO_IMAGE;
  const heroLandscape = heroLandscapeRaw ?? heroPortraitRaw ?? DEFAULT_HERO_IMAGE;

  const { contentsVisible } = await getSiteSectionVisibility();

  return (
    <div className="bg-twilight-lavender">
      {/* ===== Hero (Full-bleed Editorial Banner) ===== */}
      <section className="relative isolate w-full overflow-hidden">
        {/* --- 背景画像 (PC=横長 / スマホ=縦長 で出し分け) --- */}
        <div className="absolute inset-0 -z-10">
          {/* スマホ: 縦長 */}
          <Image
            src={heroPortrait}
            alt=""
            aria-hidden
            fill
            priority
            unoptimized={isExternal(heroPortrait)}
            sizes="100vw"
            className="object-cover md:hidden"
          />
          {/* PC: 横長 */}
          <Image
            src={heroLandscape}
            alt=""
            aria-hidden
            fill
            priority
            unoptimized={isExternal(heroLandscape)}
            sizes="100vw"
            className="hidden object-cover md:block"
          />
          {/* 可読性のためのオーバーレイ: 左を暗く落とし、全体に紫トーンを重ねる */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/25" />
          <div className="pointer-events-none absolute inset-0 bg-twilight-rose/15 mix-blend-multiply" />
        </div>

        {/* --- テキストオーバーレイ --- */}
        <div className="relative mx-auto flex min-h-[78vh] max-w-6xl flex-col justify-end px-5 pb-14 pt-28 sm:min-h-[80vh] sm:px-6 sm:pb-20 sm:pt-32 md:min-h-[88vh] md:pb-24">
          {/* 上部ラベル */}
          <p className="mb-4 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.35em] text-white/90 sm:text-sm">
            <Star className="h-3.5 w-3.5 text-twilight-rose" />
            REIRIE Official Fan Club
          </p>

          <h1 className="text-6xl font-black uppercase leading-[0.9] tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)] sm:text-8xl md:text-[8.5rem]">
            Rei<span className="text-twilight-rose">Rie</span>
            <br />
            Room
          </h1>

          <p className="mt-6 max-w-xl text-sm leading-relaxed text-white/85 drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)] sm:text-base md:text-lg">
            ファンだけが入れる、紫水晶の部屋。
            <br className="hidden sm:inline" />
            限定コンテンツ・ライブ配信・特典会・先行チケット。
            REIRIE との特別な時間をお届けします。
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/signup"
              className="rounded-full border-2 border-white bg-white px-8 py-3.5 text-center text-sm font-bold uppercase tracking-wide text-black transition hover:-translate-y-0.5 hover:border-twilight-rose hover:bg-twilight-rose hover:text-white"
            >
              入室する（無料会員登録）
            </Link>
            {contentsVisible && (
              <Link
                href="/contents"
                className="rounded-full border-2 border-white/80 bg-transparent px-8 py-3.5 text-center text-sm font-bold uppercase tracking-wide text-white backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white hover:text-black"
              >
                コンテンツを見る
              </Link>
            )}
          </div>

          {/* since バッジ (右下・オフセット影のエディトリアルアクセント) */}
          <div className="absolute bottom-8 right-5 rounded-sm bg-twilight-rose px-5 py-3 text-xs font-black uppercase tracking-wide text-white shadow-[6px_6px_0_rgba(0,0,0,0.9)] sm:bottom-12 sm:right-6 sm:text-sm">
            since 2026
          </div>
        </div>
      </section>

      {/* ===== 会員ランク ===== */}
      <section className="relative mx-auto max-w-6xl px-4 py-14 sm:py-20">
        <SectionHeading en="Membership" ja="会員ランク" />
        <div className="mt-10 grid gap-5 sm:gap-6 md:grid-cols-3">
          <RankCard
            no="01"
            rank="Crystal"
            ja="クリスタル"
            desc="まずはこちらから。お知らせと一部コンテンツを楽しめる入口の階。"
          />
          <RankCard
            no="02"
            rank="Amethyst"
            ja="アメジスト"
            desc="限定コンテンツとライブ配信が解放。最も人気のスタンダードな階。"
            featured
          />
          <RankCard
            no="03"
            rank="Royal"
            ja="ロイヤル"
            desc="見逃し配信・特別動画・会員価格グッズ・特典会優先。最上階の特別な部屋。"
          />
        </div>
      </section>

      {/* ===== 最新お知らせ ===== */}
      {latestNotices.length > 0 && (
        <section className="relative mx-auto max-w-6xl px-4 pb-4 sm:pb-8">
          <div className="rounded-sm border-2 border-black bg-white p-6 sm:p-8">
            <div className="mb-5 flex items-baseline justify-between gap-2">
              <SectionHeading en="News" ja="最新のお知らせ" align="left" compact />
              <Link
                href="/notices"
                className="text-xs font-bold uppercase tracking-wide text-black transition hover:text-twilight-rose sm:text-sm"
              >
                すべて見る →
              </Link>
            </div>
            <ul className="divide-y divide-black/10">
              {latestNotices.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/notices/${a.id}`}
                    className="flex items-start gap-3 rounded-xl px-2 py-3 transition hover:bg-twilight-lavender/30 sm:items-center sm:gap-4"
                  >
                    <time
                      dateTime={a.publishedAt?.toISOString()}
                      className="shrink-0 text-xs font-bold tabular-nums text-twilight-rose sm:text-sm"
                    >
                      {formatDate(a.publishedAt)}
                    </time>
                    <p className="line-clamp-2 flex-1 text-sm text-black sm:line-clamp-1 sm:text-base">
                      {a.title}
                    </p>
                    <span className="hidden text-black/40 sm:inline" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ===== 特典（大きなアウトライン数字のエディトリアルレイアウト） ===== */}
      <section className="relative mx-auto max-w-6xl px-4 py-14 sm:py-20">
        <SectionHeading en="Privileges" ja="会員特典" />
        <div className="mt-10 grid border-t-2 border-black sm:grid-cols-3">
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
            last
          />
        </div>
      </section>

      {/* ===== プラン ===== */}
      <section className="relative bg-white py-14 sm:py-20">
        <div className="relative mx-auto max-w-6xl px-4">
          <SectionHeading en="Plans" ja="会員プラン" />
          <div className="mt-10 grid gap-5 sm:gap-6 md:grid-cols-3">
            <PlanCard plan="FREE" />
            <PlanCard plan="STANDARD" highlight />
            <PlanCard plan="PREMIUM" />
          </div>
          <p className="mt-6 text-center text-xs text-black/60">
            ※価格は税込。年額プランは2ヶ月分お得です。
          </p>
        </div>
      </section>
    </div>
  );
}

/* ===== 5角星アイコン（差し色アクセント） ===== */
function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 0l2.7 8.3H24l-7 5.1 2.7 8.3L12 16.6 4.3 21.7 7 13.4 0 8.3h9.3z" />
    </svg>
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
      <p className="text-xs font-bold uppercase tracking-[0.35em] text-twilight-rose sm:text-sm">
        {en}
      </p>
      <h2
        className={`mt-1 font-black uppercase tracking-tight text-black ${
          compact ? 'text-lg sm:text-xl' : 'text-3xl sm:text-4xl'
        }`}
      >
        {ja}
      </h2>
    </div>
  );
}

/* ===== 会員ランクカード ===== */
function RankCard({
  no,
  rank,
  ja,
  desc,
  featured,
}: {
  no: string;
  rank: string;
  ja: string;
  desc: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-sm border-2 border-black p-6 transition hover:-translate-y-1 sm:p-7 ${
        featured ? 'bg-twilight-rose text-white' : 'bg-white text-black'
      }`}
      style={{
        boxShadow: featured ? '8px 8px 0 rgba(0,0,0,0.9)' : '4px 4px 0 rgba(0,0,0,0.9)',
      }}
    >
      {featured && (
        <span className="absolute right-5 top-5">
          <Badge tone="gray" className="bg-black text-white">
            人気
          </Badge>
        </span>
      )}
      <p
        className={`mb-3 text-xs font-bold uppercase tracking-[0.2em] ${featured ? 'text-white/70' : 'text-black/40'}`}
      >
        {no}
      </p>
      <h3 className="text-3xl font-black uppercase">{rank}</h3>
      <p className={`mt-0.5 text-sm font-bold ${featured ? 'text-white/85' : 'text-twilight-rose'}`}>
        {ja}
      </p>
      <p className={`mt-3 text-sm leading-relaxed ${featured ? 'text-white/90' : 'text-black/75'}`}>
        {desc}
      </p>
    </div>
  );
}

/* ===== 特典カード（アウトライン数字） ===== */
function FeatureCard({
  no,
  title,
  description,
  last = false,
}: {
  no: string;
  title: string;
  description: string;
  last?: boolean;
}) {
  return (
    <div
      className={`border-black p-7 sm:p-8 ${last ? '' : 'border-b-2 sm:border-b-0 sm:border-r-2'}`}
    >
      <p
        className="text-6xl font-black leading-none text-twilight-lavender"
        style={{ WebkitTextStroke: '2px #000000' }}
      >
        {no}
      </p>
      <h3 className="mt-5 text-lg font-bold text-black">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-black/75">{description}</p>
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
  const interval = PLAN_BILLING_INTERVAL[plan]; // null / 'MONTH' / 'YEAR'
  const isYearly = interval === 'YEAR';
  const mainPrice = isYearly ? price.yearly : price.monthly;
  return (
    <div
      className={`flex flex-col rounded-sm border-2 border-black p-6 transition sm:p-7 ${
        highlight ? 'bg-black text-white' : 'bg-white text-black hover:-translate-y-1'
      }`}
      style={{ boxShadow: highlight ? '8px 8px 0 rgba(194,99,162,0.9)' : undefined }}
    >
      <div className="mb-3 flex items-center justify-center gap-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em]">{PLAN_LABELS[plan]}</h3>
        {highlight && (
          <Badge tone="gray" className="bg-twilight-rose text-white">
            人気
          </Badge>
        )}
      </div>
      <p className="text-center text-4xl font-black">
        {plan === 'FREE' ? '無料' : `${formatJpy(mainPrice)}`}
        {plan !== 'FREE' && (
          <span className="text-base font-normal">/{isYearly ? '年' : '月'}</span>
        )}
      </p>
      {plan === 'PREMIUM' && (
        <p className="text-center text-sm text-black/60">会報誌 年2回 / ポイント付与率 ×2.0</p>
      )}
      <ul
        className={`mt-6 flex-1 space-y-2.5 text-left text-sm ${highlight ? 'text-white/85' : 'text-black/80'}`}
      >
        <li className="flex gap-2">
          <Check highlight={highlight} /> お知らせ閲覧
        </li>
        {plan !== 'FREE' && (
          <li className="flex gap-2">
            <Check highlight={highlight} /> 限定コンテンツ視聴
          </li>
        )}
        {plan !== 'FREE' && (
          <li className="flex gap-2">
            <Check highlight={highlight} /> ライブ配信視聴
          </li>
        )}
        {plan === 'PREMIUM' && (
          <li className="flex gap-2">
            <Check highlight={highlight} /> 見逃し配信・特別動画
          </li>
        )}
        {plan === 'PREMIUM' && (
          <li className="flex gap-2">
            <Check highlight={highlight} /> 会員価格でグッズ購入
          </li>
        )}
        {plan !== 'FREE' && (
          <li className="flex gap-2">
            <Check highlight={highlight} /> 先行チケット申込
          </li>
        )}
      </ul>
      <Link
        href={plan === 'FREE' ? '/signup' : '/me'}
        className={`mt-7 block rounded-full px-4 py-2.5 text-center text-sm font-bold uppercase tracking-wide transition ${
          highlight
            ? 'bg-twilight-rose text-white hover:opacity-90'
            : 'border-2 border-black text-black hover:bg-black hover:text-white'
        }`}
      >
        {plan === 'FREE' ? '無料登録' : 'プランを選ぶ'}
      </Link>
    </div>
  );
}

function Check({ highlight }: { highlight?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`mt-0.5 h-4 w-4 shrink-0 ${highlight ? 'text-twilight-rose' : 'text-twilight-rose'}`}
      aria-hidden="true"
    >
      <path d="M4 10.5l4 4 8-8" />
    </svg>
  );
}
