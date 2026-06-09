/**
 * デモモード専用: メモリ上のミュータブルストア
 *
 * announcements / systemSettings のように Prisma スキーマに存在しない
 * (今後追加予定の) リソースをメモリで管理する。
 *
 * 注意: サーバ再起動でリセット。本番では Prisma モデルを追加して置き換える。
 */

import { env } from './env';

type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: 'ALL' | 'MEMBERS' | 'PREMIUM';
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  authorId: string | null;
};

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
  announcements: Announcement[];
  settings: Setting[];
};
type GlobalWithStore = typeof globalThis & { [k: symbol]: Store | undefined };
const g = globalThis as GlobalWithStore;

function load(): Store {
  if (g[globalKey]) return g[globalKey]!;
  // 初期データ
  const now = new Date();
  const init: Store = {
    announcements: [
      {
        id: 'ann-001',
        title: '【重要】システムメンテナンスのお知らせ',
        body:
          '6月15日 2:00 - 5:00 にメンテナンスを実施します。\n\n■ 影響範囲\n・全機能停止\n\nご不便をおかけしますが、ご理解の程よろしくお願いいたします。',
        audience: 'ALL',
        status: 'PUBLISHED',
        publishedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        authorId: '00000000-0000-0000-0000-000000000003',
      },
      {
        id: 'ann-002',
        title: 'プレミアム会員限定: 新章『海辺の告白』公開!',
        body:
          'プレミアム会員の皆さま、お待たせしました!\n蒼井大翔の新章が本日公開されました。',
        audience: 'PREMIUM',
        status: 'PUBLISHED',
        publishedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        authorId: '00000000-0000-0000-0000-000000000002',
      },
      {
        id: 'ann-003',
        title: '新グッズ予約受付開始(下書き)',
        body: '夏のスペシャルグッズが新登場。',
        audience: 'ALL',
        status: 'DRAFT',
        publishedAt: null,
        createdAt: new Date(now.getTime() - 8 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 8 * 60 * 60 * 1000),
        authorId: '00000000-0000-0000-0000-000000000002',
      },
    ],
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
// Announcements
// =================================================================
export function listAnnouncements(): Announcement[] {
  return [...load().announcements].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

export function getAnnouncement(id: string): Announcement | null {
  return load().announcements.find((a) => a.id === id) ?? null;
}

export function createAnnouncement(
  input: Omit<Announcement, 'id' | 'createdAt' | 'updatedAt' | 'publishedAt'> & {
    publishedAt?: Date | null;
  },
): Announcement {
  const now = new Date();
  const a: Announcement = {
    ...input,
    id: 'ann-' + Math.random().toString(36).slice(2, 10),
    publishedAt: input.publishedAt ?? (input.status === 'PUBLISHED' ? now : null),
    createdAt: now,
    updatedAt: now,
  };
  load().announcements.push(a);
  return a;
}

export function updateAnnouncement(
  id: string,
  patch: Partial<Omit<Announcement, 'id' | 'createdAt'>>,
): Announcement | null {
  const list = load().announcements;
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  const prev = list[idx]!;
  const next: Announcement = {
    ...prev,
    ...patch,
    updatedAt: new Date(),
  };
  // status を DRAFT → PUBLISHED へ変更したら publishedAt をセット
  if (prev.status === 'DRAFT' && next.status === 'PUBLISHED' && !next.publishedAt) {
    next.publishedAt = new Date();
  }
  list[idx] = next;
  return next;
}

export function deleteAnnouncement(id: string): boolean {
  const list = load().announcements;
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
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
