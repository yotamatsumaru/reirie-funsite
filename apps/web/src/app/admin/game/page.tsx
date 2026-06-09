/**
 * /admin/game — ゲーム管理ダッシュボード
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';

export const metadata: Metadata = { title: 'ゲーム管理' };
export const dynamic = 'force-dynamic';

export default async function AdminGameTopPage() {
  const [characters, scenarios, items, players] = await Promise.all([
    prisma.gameCharacter.count(),
    prisma.gameScenario.count(),
    prisma.gameItem.count(),
    prisma.playerProgress.count(),
  ]);

  const cards = [
    { href: '/admin/game/characters', label: 'キャラクター', count: characters, color: 'bg-pink-50 text-pink-700' },
    { href: '/admin/game/scenarios', label: 'シナリオ章', count: scenarios, color: 'bg-violet-50 text-violet-700' },
    { href: '/admin/game/items', label: 'アイテム / プレゼント', count: items, color: 'bg-amber-50 text-amber-700' },
    { href: '/admin/game/players', label: 'プレイヤー進捗', count: players, color: 'bg-sky-50 text-sky-700' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">ゲーム管理 (恋愛 ADV)</h1>
        <p className="mt-1 text-sm text-slate-500">
          キャラクター・章・アイテム・プレイヤー進捗を管理します。
          <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            確定報酬型 DLC のみ (ガチャ禁止)
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.href} href={c.href}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardBody>
                <div className={`inline-block rounded-md px-2 py-1 text-xs font-semibold ${c.color}`}>
                  {c.label}
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-800">{c.count}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardBody className="space-y-2 text-sm text-slate-700">
          <p className="font-semibold text-slate-800">運用上の注意 (重要)</p>
          <ul className="list-inside list-disc space-y-1 text-xs text-slate-600">
            <li>すべての課金は<strong>確定報酬</strong>とすること (ガチャ・ランダム要素は法令上禁止)</li>
            <li>キャラに恋愛感情を抱かせるシナリオは <strong>17+ 表示</strong>を必須とする (App Store ガイドライン 1.1.4 / 5.0)</li>
            <li>章公開前に必ず<strong>シナリオ JSON 検証</strong>と<strong>ダミー再生</strong>を行うこと</li>
            <li>事務所側の<strong>シナリオ承認</strong>がないキャラは PUBLISHED にしないこと</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
