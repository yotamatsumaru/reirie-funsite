/**
 * /super-admin/game-settings — ゲーム設定 (インデックス)
 *
 * ゲームごとに設定ページを分離するためのハブ。
 * 各ゲームの詳細設定 (勝率 / 特典ボーナス / キャラボイス / キャラ画像 / サムネイル) は
 * /super-admin/game-settings/<slug> に置く。
 * 売上・統計を扱う「ゲーム経済」(/super-admin/game) とは役割を分離している。
 *
 * このページの先頭に「ゲームごとの公開 / 非公開トグル」を置いている。
 * ゲームを触る運営が最初に開く画面がここなので、公開操作もここに集約するのが
 * 分かりやすい (サイト全体のマスタースイッチは /super-admin/settings)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { getGameVisibility, getSiteSectionVisibility } from '@/lib/app-setting';
import { isGameKey } from '@idol/shared';
import { GAME_SETTINGS_GAMES } from './games';
import { GameVisibilityClient } from './game-visibility-client';

export const metadata: Metadata = { title: 'ゲーム設定 | Super Admin' };
export const dynamic = 'force-dynamic';

export default async function SuperAdminGameSettingsIndexPage() {
  const [visibility, { gamesVisible }] = await Promise.all([
    getGameVisibility(),
    getSiteSectionVisibility(),
  ]);

  return (
    <main>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">ゲーム設定</h1>
        <p className="mt-1 text-sm text-slate-500">
          ゲームごとに公開 / 非公開を切り替えたり、勝率・特典ボーナス・キャラボイス・
          キャラクター画像・サムネイルなどを設定できます。売上・統計は「ゲーム経済」で確認できます。
        </p>
      </header>

      {/* ===== ゲームごとの公開 / 非公開 ===== */}
      <GameVisibilityClient initialVisibility={visibility} gamesVisible={gamesVisible} />

      {/* ===== 各ゲームの詳細設定 ===== */}
      <h2 className="mb-3 text-sm font-semibold text-slate-800">各ゲームの詳細設定</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GAME_SETTINGS_GAMES.map((g) => {
          // 公開設定はゲームキー単位。設定ページしか無いゲーム (キー未登録) は
          // 判定対象外なので、バッジを出さない。
          const isHidden =
            isGameKey(g.slug) && (!visibility[g.slug] || !gamesVisible);
          return (
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
                    {isHidden && <Badge tone="warning">非公開</Badge>}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{g.description}</p>
                  <p className="mt-3 text-xs font-semibold text-twilight-amethyst group-hover:underline">
                    設定を開く →
                  </p>
                </CardBody>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
