/**
 * /super-admin/game-settings — ゲーム設定 (インデックス)
 *
 * ゲームごとに設定ページを分離するためのハブ。
 * 各ゲームの詳細設定 (勝率 / 特典ボーナス / キャラボイス / キャラ画像 / サムネイル) は
 * /super-admin/game-settings/<slug> に置く。
 * 売上・統計を扱う「ゲーム経済」(/super-admin/game) とは役割を分離している。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/Card';
import { GAME_SETTINGS_GAMES } from './games';

export const metadata: Metadata = { title: 'ゲーム設定 | Super Admin' };
export const dynamic = 'force-dynamic';

export default function SuperAdminGameSettingsIndexPage() {
  return (
    <main>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">ゲーム設定</h1>
        <p className="mt-1 text-sm text-slate-500">
          設定したいゲームを選んでください。ゲームごとに勝率・特典ボーナス・キャラボイス・
          キャラクター画像・サムネイルなどを設定できます。売上・統計は「ゲーム経済」で確認できます。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GAME_SETTINGS_GAMES.map((g) => (
          <Link
            key={g.slug}
            href={`/super-admin/game-settings/${g.slug}`}
            className="group block"
          >
            <Card className="h-full transition-shadow hover:shadow-lg">
              <CardBody>
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{g.emoji}</span>
                  <p className="text-base font-bold text-slate-900">{g.title}</p>
                </div>
                <p className="mt-2 text-sm text-slate-600">{g.description}</p>
                <p className="mt-3 text-xs font-semibold text-twilight-amethyst group-hover:underline">
                  設定を開く →
                </p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
