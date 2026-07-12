/**
 * デモモード専用: メモリ上のミュータブルストア
 *
 * systemSettings のように Prisma スキーマに存在しない
 * (今後追加予定の) リソースをメモリで管理する。
 *
 * 注意: サーバ再起動でリセット。本番では Prisma モデルを追加して置き換える。
 *
 * announcements (お知らせ配信) は Prisma モデル化済み。
 * @/lib/announcements を参照。
 */

import { env } from './env';

type Setting = {
  key: string;
  value: string | number | boolean;
  label: string;
  description: string;
  category: 'system' | 'features' | 'pricing';
};

// グローバル変数で hot-reload 耐性
const globalKey = Symbol.for('@idol/demo-store');
type Store = {
  settings: Setting[];
};
type GlobalWithStore = typeof globalThis & { [k: symbol]: Store | undefined };
const g = globalThis as GlobalWithStore;

function load(): Store {
  if (g[globalKey]) return g[globalKey]!;
  // 初期データ
  const init: Store = {
    settings: [
      { key: 'maintenance.enabled', value: false, label: 'メンテナンスモード', description: '有効にすると全ユーザーが /maintenance にリダイレクト', category: 'system' },
      { key: 'features.gameEnabled', value: true, label: 'ゲーム機能', description: '恋愛 ADV ゲーム全体を ON/OFF', category: 'features' },
      { key: 'features.commentsEnabled', value: true, label: 'コメント機能', description: 'コンテンツのコメント投稿を ON/OFF', category: 'features' },
      { key: 'features.liveEnabled', value: true, label: 'ライブ配信機能', description: 'IVS ライブ機能の ON/OFF', category: 'features' },
      { key: 'features.ticketsEnabled', value: true, label: 'チケット連携', description: 'Lawson チケット連携機能の ON/OFF', category: 'features' },
      { key: 'shipping.freeThresholdStandard', value: 8000, label: 'STANDARD 送料無料閾値', description: 'STANDARD 会員の送料無料金額 (円)', category: 'pricing' },
      { key: 'shipping.fee', value: 600, label: '標準送料', description: '基本送料 (円)', category: 'pricing' },
      { key: 'monthlyBonus.standard', value: 1, label: 'STANDARD 月次ボーナス', description: 'STANDARD 会員の月次プレゼント数', category: 'pricing' },
      { key: 'monthlyBonus.premium', value: 5, label: 'PREMIUM 月次ボーナス', description: 'PREMIUM 会員の月次プレゼント数', category: 'pricing' },
    ],
  };
  g[globalKey] = init;
  return init;
}

// =================================================================
// System Settings
// =================================================================
export function listSettings(): Setting[] {
  return [...load().settings];
}

export function getSetting(key: string): Setting | null {
  return load().settings.find((s) => s.key === key) ?? null;
}

export function updateSetting(
  key: string,
  value: Setting['value'],
): Setting | null {
  const list = load().settings;
  const idx = list.findIndex((s) => s.key === key);
  if (idx < 0) return null;
  list[idx] = { ...list[idx]!, value };
  return list[idx]!;
}

export function isDemoStoreAvailable(): boolean {
  return env.demoMode;
}
