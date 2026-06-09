/**
 * /game — キャラクター一覧 (恋愛 ADV LP)
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = {
  title: '恋愛 ADV — ストーリー',
  description: '推しキャラとの物語を、あなただけの選択で進めるオフィシャル恋愛 ADV。',
};
export const dynamic = 'force-dynamic';

export default async function GameTopPage() {
  const session = await auth();
  const isPremium = session?.user?.plan === 'PREMIUM';

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
        <p className="text-xs font-semibold tracking-widest text-brand-600">OFFICIAL ROMANCE ADV</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-4xl">
          ストーリー
        </h1>
        <p className="mt-3 text-sm text-slate-600 sm:text-base">
          推しキャラとの物語を、あなただけの選択で進めましょう。
        </p>
        <p className="mt-2 text-xs text-slate-500">
          ※ 課金はすべて確定報酬型 DLC です。ガチャ要素はありません。
        </p>
      </header>

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
