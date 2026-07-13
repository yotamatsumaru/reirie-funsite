/**
 * /game — ゲーム一覧 (ミニゲーム + 恋愛 ADV ストーリー)
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import {
  ACCHI_MAX_PLAYS_PER_DAY,
  ACCHI_WIN_REWARD,
  gameThumbnailSlot,
} from '@idol/shared';
import { auth } from '@/auth';
import { getSiteImageUrlMap } from '@/lib/site-image';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = {
  title: 'ゲーム一覧',
  description: 'ミニゲームでポイントを貯めたり、推しキャラとの物語を楽しめるゲーム一覧。',
};
export const dynamic = 'force-dynamic';

/** ミニゲーム一覧 (将来追加しやすいよう配列で定義) */
const MINI_GAMES: {
  slug: string;
  title: string;
  emoji: string;
  href: string;
  description: string;
  themeColor: string;
  badges: string[];
  requiresAuth: boolean;
}[] = [
  {
    slug: 'acchi',
    title: 'あっちむいてPUI',
    emoji: '👉',
    href: '/me/games/acchi',
    description:
      'REIRIE とあっちむいてPUIで勝負! 勝つとポイントがもらえます。',
    themeColor: '#ede9fe',
    badges: [`1日${ACCHI_MAX_PLAYS_PER_DAY}回まで`, `勝利で${ACCHI_WIN_REWARD}pt`, '無料'],
    requiresAuth: true,
  },
];

export default async function GameTopPage() {
  const session = await auth();
  const isAuthenticated = !!session?.user?.id;
  const isPremium = session?.user?.plan === 'PREMIUM';

  // ミニゲームのサムネイル画像 (管理画面でアップロード)。未設定なら絵文字表示。
  const siteImageMap = await getSiteImageUrlMap();

  const characters = await prisma.gameCharacter.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      _count: { select: { scenarios: { where: { status: 'PUBLISHED' } } } },
    },
  });

  return (
    <main className="mx-auto max-w-6xl px-3 py-6 sm:px-4 sm:py-10">
      <header className="mb-8 text-center">
        <p className="text-xs font-semibold tracking-widest text-brand-600">GAMES</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-4xl">
          ゲーム一覧
        </h1>
        <p className="mt-3 text-sm text-slate-600 sm:text-base">
          ミニゲームでポイントを貯めたり、推しキャラとの物語を楽しめます。
        </p>
      </header>

      {/* ===== ミニゲーム ===== */}
      <section className="mb-12">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900 sm:text-xl">🎮 ミニゲーム</h2>
          <Badge tone="success">ポイントが貯まる</Badge>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MINI_GAMES.map((g) => {
            const href = g.requiresAuth && !isAuthenticated
              ? `/signin?next=${encodeURIComponent(g.href)}`
              : g.href;
            const thumbnailUrl = (siteImageMap as Record<string, string | undefined>)[
              gameThumbnailSlot(g.slug)
            ];
            return (
              <Link key={g.slug} href={href} className="group block">
                <Card className="h-full overflow-hidden transition-shadow hover:shadow-lg">
                  {thumbnailUrl ? (
                    <div className="aspect-[16/9] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbnailUrl}
                        alt={g.title}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </div>
                  ) : (
                    <div
                      className="flex aspect-[16/9] items-center justify-center text-6xl"
                      style={{ backgroundColor: g.themeColor }}
                    >
                      <span className="transition-transform duration-500 group-hover:scale-110">
                        {g.emoji}
                      </span>
                    </div>
                  )}
                  <CardBody>
                    <p className="text-base font-bold text-slate-900 sm:text-lg">{g.title}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">{g.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {g.badges.map((b) => (
                        <Badge key={b} tone="brand">
                          {b}
                        </Badge>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ===== 恋愛 ADV ストーリー ===== */}
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-bold text-slate-900 sm:text-xl">💗 恋愛 ADV ストーリー</h2>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        ※ 課金はすべて確定報酬型 DLC です。ガチャ要素はありません。
      </p>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {characters.length === 0 && (
          <Card className="col-span-full">
            <CardBody className="py-12 text-center text-sm text-slate-500">
              キャラクターは準備中です。お楽しみに!
            </CardBody>
          </Card>
        )}
        {characters.map((c) => {
          const locked = c.isPremiumOnly && !isPremium;
          return (
            <Link
              key={c.id}
              href={locked ? '/me/subscription' : `/game/${c.slug}`}
              className="group block"
            >
              <Card className="h-full overflow-hidden transition-shadow hover:shadow-lg">
                <div
                  className="relative aspect-[3/4] overflow-hidden"
                  style={{
                    backgroundColor: c.themeColor ?? '#fce7f3',
                  }}
                >
                  {c.portraitUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.portraitUrl}
                      alt={c.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-6xl text-white/60">
                      ♡
                    </div>
                  )}
                  {locked && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-semibold text-white">
                      🔒 PREMIUM 会員限定
                    </div>
                  )}
                </div>
                <CardBody>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-bold text-slate-900 sm:text-lg">{c.name}</p>
                      {c.furigana && (
                        <p className="text-xs text-slate-500">{c.furigana}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {c.isPremiumOnly && <Badge tone="brand">PREMIUM</Badge>}
                      <Badge tone="gray">{c._count.scenarios}章</Badge>
                    </div>
                  </div>
                  {c.catchcopy && (
                    <p className="mt-2 line-clamp-2 text-sm text-slate-600">{c.catchcopy}</p>
                  )}
                </CardBody>
              </Card>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
