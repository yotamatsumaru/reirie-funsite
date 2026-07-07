/**
 * /super-admin/game — ゲーム経済 (DLC 売上 / アイテム集計 / プレイヤー統計)
 */
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { getAcchiWinSettings, getAcchiRewardBonusSettings } from '@/lib/app-setting';
import { listGameAudio } from '@/lib/game-audio';
import { AcchiSettingsClient } from './acchi-settings-client';
import { AcchiRewardBonusClient } from './acchi-reward-bonus-client';
import { GameAudioClient, type GameAudioItem } from './game-audio-client';

export const metadata: Metadata = { title: 'ゲーム経済 | Super Admin' };
export const dynamic = 'force-dynamic';

type Purchase = {
  id: string;
  userId: string;
  kind: 'SCENARIO' | 'ITEM';
  scenarioId: string | null;
  itemId: string | null;
  quantity: number;
  amountJpy: number;
  paymentStatus: string;
  paidAt: Date | null;
  createdAt: Date;
};

type Progress = {
  id: string;
  userId: string;
  characterId: string;
  affinity: number;
  scenariosCleared: number;
  lastPlayedAt: Date | null;
};

type Scenario = { id: string; slug: string; title: string; priceJpy: number };
type Item = { id: string; slug: string; name: string; priceJpy: number };
type Character = { id: string; name: string; slug: string };

export default async function SuperAdminGamePage() {
  const [
    purchases,
    progress,
    scenarios,
    items,
    characters,
    acchiSettings,
    acchiRewardBonusSettings,
    gameAudio,
  ] = await Promise.all([
    prisma.playerPurchase.findMany({}),
    prisma.playerProgress.findMany({}),
    prisma.gameScenario.findMany({}),
    prisma.gameItem.findMany({}),
    prisma.gameCharacter.findMany({}),
    getAcchiWinSettings(),
    getAcchiRewardBonusSettings(),
    listGameAudio(),
  ]);
  const gameAudioItems: GameAudioItem[] = gameAudio.map((a) => ({
    slot: a.slot,
    url: a.url,
    fileName: a.fileName,
    sizeBytes: a.sizeBytes,
    updatedAt: a.updatedAt.toISOString(),
  }));
  const purchasesT = purchases as unknown as Purchase[];
  const progressT = progress as unknown as Progress[];
  const scenariosT = scenarios as unknown as Scenario[];
  const itemsT = items as unknown as Item[];
  const charactersT = characters as unknown as Character[];

  const paid = purchasesT.filter((p) => p.paymentStatus === 'SUCCEEDED');

  // KPI
  const totalDlcRevenue = paid.reduce((a, p) => a + p.amountJpy, 0);
  const scenarioRevenue = paid
    .filter((p) => p.kind === 'SCENARIO')
    .reduce((a, p) => a + p.amountJpy, 0);
  const itemRevenue = paid
    .filter((p) => p.kind === 'ITEM')
    .reduce((a, p) => a + p.amountJpy, 0);
  const uniqueBuyers = new Set(paid.map((p) => p.userId)).size;
  const activePlayers = progressT.length;

  // シナリオ別売上
  const scenarioStats = scenariosT
    .map((s) => {
      const buys = paid.filter((p) => p.scenarioId === s.id);
      return {
        ...s,
        count: buys.reduce((a, p) => a + p.quantity, 0),
        revenue: buys.reduce((a, p) => a + p.amountJpy, 0),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // アイテム別売上
  const itemStats = itemsT
    .map((it) => {
      const buys = paid.filter((p) => p.itemId === it.id);
      return {
        ...it,
        count: buys.reduce((a, p) => a + p.quantity, 0),
        revenue: buys.reduce((a, p) => a + p.amountJpy, 0),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // キャラ別進捗
  const charStats = charactersT.map((c) => {
    const players = progressT.filter((p) => p.characterId === c.id);
    const avgAffinity =
      players.length > 0
        ? Math.round(players.reduce((a, p) => a + p.affinity, 0) / players.length)
        : 0;
    return {
      ...c,
      players: players.length,
      avgAffinity,
    };
  });

  const fmtJpy = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

  return (
    <main>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">ゲーム経済</h1>
        <p className="mt-1 text-sm text-slate-500">
          恋愛 ADV の DLC 売上・アイテム消費・プレイヤー統計
        </p>
      </header>

      {/* KPI */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Kpi label="DLC 総売上" value={fmtJpy(totalDlcRevenue)} sub={`${paid.length} 件`} accent="violet" />
        <Kpi label="シナリオ売上" value={fmtJpy(scenarioRevenue)} sub="章購入" accent="brand" />
        <Kpi label="アイテム売上" value={fmtJpy(itemRevenue)} sub="ギフト等" accent="emerald" />
        <Kpi label="購入者数" value={`${uniqueBuyers}名`} sub="ユニーク" accent="rose" />
        <Kpi label="プレイヤー" value={`${activePlayers}名`} sub="進捗あり" accent="amber" />
      </section>

      {/* あっち向いてホイ 勝率設定 */}
      <AcchiSettingsClient initial={acchiSettings} />

      {/* あっち向いてホイ 勝利特典ポイントボーナス設定 */}
      <AcchiRewardBonusClient initial={acchiRewardBonusSettings} />

      {/* あっち向いてホイ キャラボイス アップロード */}
      <GameAudioClient initial={gameAudioItems} />

      {/* シナリオ別 */}
      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">シナリオ別 売上ランキング</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">タイトル</th>
                <th className="px-4 py-3 text-right">単価</th>
                <th className="px-4 py-3 text-right">販売数</th>
                <th className="px-4 py-3 text-right">売上</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scenarioStats.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{s.title}</p>
                    <p className="font-mono text-xs text-slate-500">{s.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-xs">
                    {s.priceJpy === 0 ? (
                      <Badge tone="success">無料</Badge>
                    ) : (
                      <span className="tabular-nums">{fmtJpy(s.priceJpy)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.count}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {fmtJpy(s.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </CardBody>
      </Card>

      {/* アイテム別 */}
      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">アイテム別 売上ランキング</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">アイテム</th>
                <th className="px-4 py-3 text-right">単価</th>
                <th className="px-4 py-3 text-right">販売数</th>
                <th className="px-4 py-3 text-right">売上</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {itemStats.map((it) => (
                <tr key={it.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{it.name}</p>
                    <p className="font-mono text-xs text-slate-500">{it.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-xs tabular-nums">
                    {fmtJpy(it.priceJpy)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{it.count}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {fmtJpy(it.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </CardBody>
      </Card>

      {/* キャラ別プレイヤー統計 */}
      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">キャラ別 プレイヤー統計</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">キャラクター</th>
                <th className="px-4 py-3 text-right">プレイヤー数</th>
                <th className="px-4 py-3">平均好感度</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {charStats.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.players}名</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 overflow-hidden rounded-full bg-slate-100 max-w-xs">
                        <div
                          className="h-full bg-rose-500"
                          style={{ width: `${c.avgAffinity}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-600 w-12 text-right">
                        {c.avgAffinity} / 100
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: 'brand' | 'emerald' | 'violet' | 'rose' | 'amber';
}) {
  const colors = {
    brand: 'from-brand-50 to-brand-100 text-brand-700 ring-brand-200',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-700 ring-emerald-200',
    violet: 'from-violet-50 to-violet-100 text-violet-700 ring-violet-200',
    rose: 'from-rose-50 to-rose-100 text-rose-700 ring-rose-200',
    amber: 'from-amber-50 to-amber-100 text-amber-700 ring-amber-200',
  };
  return (
    <div className={`rounded-lg bg-gradient-to-br p-4 ring-1 ${colors[accent]}`}>
      <p className="text-xs font-semibold opacity-80">{label}</p>
      <p className="mt-2 text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs opacity-70">{sub}</p>}
    </div>
  );
}
