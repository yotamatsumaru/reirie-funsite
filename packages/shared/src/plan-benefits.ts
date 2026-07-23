/**
 * 会員プラン特典の一元定義
 *
 * このファイルはフロント (プラン紹介ページ等) とバック (アクセス制御 / 送料計算 /
 * セーブスロット制限 / 月次ボーナス等) の両方から参照される single source of truth。
 *
 * 仕様確定: 2026-06-26 (3 プラン体制へ刷新)
 * - FREE     : 無料 (アカウント作成のみ)
 * - STANDARD : 月額 ¥666 (税込) / 会報誌なし / Pui 付与率ひかえめ
 * - PREMIUM  : 年額 ¥7,920 (税込) / 会報誌 年2回送付 / Pui 付与率が一番良い
 */
import type { PlanTypeLiteral } from './constants';

// ===================================================================
// 数値特典 (送料 / セーブスロット / ボーナスギフト / 動画画質 等)
// ===================================================================

/**
 * セーブスロット数 (ゲーム)
 * FREE=1 / STANDARD=3 / PREMIUM=10
 */
export const SAVE_SLOT_LIMIT: Record<PlanTypeLiteral, number> = {
  FREE: 1,
  STANDARD: 3,
  PREMIUM: 10,
};

/**
 * 送料無料となる小計 (円)
 * - FREE     : ¥8,000 以上で送料無料 (デフォルト)
 * - STANDARD : ¥8,000 以上で送料無料
 * - PREMIUM  : 常時送料無料 (閾値 0)
 */
export const FREE_SHIPPING_THRESHOLD_BY_PLAN: Record<PlanTypeLiteral, number> = {
  FREE: 8000,
  STANDARD: 8000,
  PREMIUM: 0,
};

/**
 * 月次ボーナスギフト付与数
 * - FREE     : 0
 * - STANDARD : 1 個/月
 * - PREMIUM  : 5 個/月
 */
export const MONTHLY_BONUS_GIFT_COUNT: Record<PlanTypeLiteral, number> = {
  FREE: 0,
  STANDARD: 1,
  PREMIUM: 5,
};

/**
 * サイト内 Pui 付与率の倍率 (プラン別)。
 *
 * ログインボーナス / SNS シェア / ミニゲーム勝利報酬などで獲得できる
 * ベース Pui に対して、この倍率を掛けて実際の付与量を決める。
 *
 * - FREE     : 1.0 倍 (ベース)
 * - STANDARD : 1.2 倍 (少し優遇)
 * - PREMIUM  : 2.0 倍 (付与率が一番良い)
 *
 * 倍率適用後は必ず整数へ丸める (Math.round)。具体的な丸めは
 * applyPlanPuiMultiplier() を使うこと。
 */
export const PLAN_PUI_MULTIPLIER: Record<PlanTypeLiteral, number> = {
  FREE: 1.0,
  STANDARD: 1.2,
  PREMIUM: 2.0,
};

/**
 * ベース Pui にプラン倍率を適用し、整数へ丸めて返す。
 *  - amount が 0 以下のときは 0 を返す (倍率は掛けない)。
 *  - 丸めは四捨五入 (Math.round)。
 */
export function applyPlanPuiMultiplier(
  amount: number,
  plan: PlanTypeLiteral,
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * (PLAN_PUI_MULTIPLIER[plan] ?? 1));
}

/**
 * 倍率の表示用ラベル (例: "×2.0")。プラン紹介ページで使用。
 */
export const PLAN_PUI_MULTIPLIER_LABEL: Record<PlanTypeLiteral, string> = {
  FREE: '×1.0',
  STANDARD: '×1.2',
  PREMIUM: '×2.0',
};

/**
 * 会報誌の年間送付回数。
 * - FREE     : 0 (なし)
 * - STANDARD : 0 (なし)
 * - PREMIUM  : 2 (年2回送付)
 */
export const NEWSLETTER_ISSUES_PER_YEAR: Record<PlanTypeLiteral, number> = {
  FREE: 0,
  STANDARD: 0,
  PREMIUM: 2,
};

/**
 * 月次ボーナスとして付与するデフォルトアイテムの slug。
 * GameItem テーブルにこの slug のレコードを seed しておく必要がある。
 */
export const DEFAULT_BONUS_GIFT_SLUG = 'monthly-bonus-bouquet';

/**
 * "YYYY-MM" 形式の現在月を返す (UTC)
 */
export function currentYearMonth(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * 動画再生時に許可される最大画質
 * - FREE     : 480p
 * - STANDARD : 720p
 * - PREMIUM  : 1080p (フル HD)
 */
export const VIDEO_QUALITY_LITERALS = ['480p', '720p', '1080p'] as const;
export type VideoQualityLiteral = (typeof VIDEO_QUALITY_LITERALS)[number];

export const MAX_VIDEO_QUALITY: Record<PlanTypeLiteral, VideoQualityLiteral> = {
  FREE: '480p',
  STANDARD: '720p',
  PREMIUM: '1080p',
};

const VIDEO_QUALITY_RANK: Record<VideoQualityLiteral, number> = {
  '480p': 0,
  '720p': 1,
  '1080p': 2,
};

/**
 * 指定プランで指定画質が再生可能か
 */
export function canPlayQuality(
  plan: PlanTypeLiteral,
  quality: VideoQualityLiteral,
): boolean {
  return VIDEO_QUALITY_RANK[quality] <= VIDEO_QUALITY_RANK[MAX_VIDEO_QUALITY[plan]];
}

/**
 * 指定プランで再生可能な画質リスト
 */
export function allowedVideoQualities(plan: PlanTypeLiteral): VideoQualityLiteral[] {
  return VIDEO_QUALITY_LITERALS.filter((q) => canPlayQuality(plan, q));
}

/**
 * ライブのアーカイブ視聴可能日数
 * - FREE     : 0 (視聴不可)
 * - STANDARD : 7 日間
 * - PREMIUM  : -1 (無期限)
 */
export const LIVE_ARCHIVE_RETENTION_DAYS: Record<PlanTypeLiteral, number> = {
  FREE: 0,
  STANDARD: 7,
  PREMIUM: -1, // -1 = 無期限
};

// ===================================================================
// ブーリアン特典 (機能の解放 / 制限)
// ===================================================================

/**
 * ゲームの章購入が PREMIUM 会員は無料か (isPremiumIncluded が立っている章のみ)
 */
export const PREMIUM_INCLUDES_SCENARIOS: Record<PlanTypeLiteral, boolean> = {
  FREE: false,
  STANDARD: false,
  PREMIUM: true,
};

/**
 * 広告非表示
 * - 現状コードに広告システムは未実装。将来用意する想定で仕様だけ定義。
 */
export const HIDE_ADS: Record<PlanTypeLiteral, boolean> = {
  FREE: false,
  STANDARD: true,
  PREMIUM: true,
};

/**
 * プレミアムバッジ (UI 表示)
 */
export const SHOW_PREMIUM_BADGE: Record<PlanTypeLiteral, boolean> = {
  FREE: false,
  STANDARD: false,
  PREMIUM: true,
};

/**
 * コメント投稿可能か (STANDARD 以上)
 */
export const CAN_POST_COMMENT: Record<PlanTypeLiteral, boolean> = {
  FREE: false,
  STANDARD: true,
  PREMIUM: true,
};

// ===================================================================
// 比較表 (プラン紹介ページ /plans で使用)
// ===================================================================

/**
 * 比較表の 1 行
 * - value は表示用テキスト (例: "✓" / "—" / "7日間" / "1080p" 等)
 * - bool は機械的判定 (true/false 想定)
 */
export interface PlanBenefitRow {
  category: string;
  label: string;
  free: string;
  standard: string;
  premium: string;
  highlight?: boolean; // 「目玉特典」マーカ
}

const TICK = '✓';
const DASH = '—';

export const PLAN_BENEFITS_TABLE: PlanBenefitRow[] = [
  // ===== 会員特典 (目玉) =====
  {
    category: '会員特典',
    label: 'サイト内 Pui 付与率',
    free: '×1.0',
    standard: '×1.2',
    premium: '×2.0',
    highlight: true,
  },
  {
    category: '会員特典',
    label: '会報誌の送付',
    free: DASH,
    standard: DASH,
    premium: '年2回',
    highlight: true,
  },
  // ===== 記事 =====
  { category: '記事・ニュース', label: '公開記事の閲覧', free: TICK, standard: TICK, premium: TICK },
  { category: '記事・ニュース', label: '会員限定記事', free: DASH, standard: TICK, premium: TICK },
  { category: '記事・ニュース', label: 'プレミアム独占記事', free: DASH, standard: DASH, premium: TICK },
  { category: '記事・ニュース', label: 'コメント投稿', free: DASH, standard: TICK, premium: TICK },
  // ===== 動画 =====
  { category: '動画', label: '公開動画の視聴', free: TICK, standard: TICK, premium: TICK },
  { category: '動画', label: '会員限定動画', free: DASH, standard: TICK, premium: TICK },
  { category: '動画', label: 'プレミアム独占動画', free: DASH, standard: DASH, premium: TICK },
  { category: '動画', label: '高画質再生', free: '480p', standard: '720p', premium: '1080p', highlight: true },
  // ===== ライブ =====
  { category: 'ライブ配信', label: '公開ライブ視聴', free: TICK, standard: TICK, premium: TICK },
  { category: 'ライブ配信', label: 'メンバー限定ライブ', free: DASH, standard: TICK, premium: TICK },
  { category: 'ライブ配信', label: 'プレミアム限定ライブ', free: DASH, standard: DASH, premium: TICK },
  { category: 'ライブ配信', label: 'アーカイブ視聴期間', free: '視聴不可', standard: '7 日間', premium: '無期限', highlight: true },
  // ===== 物販 =====
  { category: '物販', label: '商品閲覧', free: TICK, standard: TICK, premium: TICK },
  { category: '物販', label: '会員限定商品', free: DASH, standard: TICK, premium: TICK },
  { category: '物販', label: 'プレミアム独占商品', free: DASH, standard: DASH, premium: TICK },
  { category: '物販', label: '会員価格', free: DASH, standard: TICK, premium: TICK },
  { category: '物販', label: 'プレミアム価格', free: DASH, standard: DASH, premium: TICK },
  { category: '物販', label: '送料無料', free: '¥8,000 以上', standard: '¥8,000 以上', premium: '常時無料', highlight: true },
  // ===== チケット =====
  { category: 'チケット', label: '一般販売', free: TICK, standard: TICK, premium: TICK },
  { category: 'チケット', label: 'スタンダード先行予約', free: DASH, standard: TICK, premium: TICK },
  { category: 'チケット', label: 'プレミアム最速先行', free: DASH, standard: DASH, premium: TICK },
  // ===== ゲーム =====
  { category: '🎮 恋愛 ADV ゲーム', label: 'プロローグ', free: TICK, standard: TICK, premium: TICK },
  { category: '🎮 恋愛 ADV ゲーム', label: '通常章 (¥300〜)', free: '都度購入', standard: '都度購入', premium: '読み放題', highlight: true },
  { category: '🎮 恋愛 ADV ゲーム', label: 'プレミアム限定キャラ', free: DASH, standard: DASH, premium: TICK },
  { category: '🎮 恋愛 ADV ゲーム', label: 'プレミアム限定章', free: DASH, standard: DASH, premium: TICK },
  { category: '🎮 恋愛 ADV ゲーム', label: 'プレミアム限定ギフト', free: DASH, standard: DASH, premium: TICK },
  { category: '🎮 恋愛 ADV ゲーム', label: '月次ボーナスギフト', free: DASH, standard: '1 個/月', premium: '5 個/月', highlight: true },
  { category: '🎮 恋愛 ADV ゲーム', label: 'セーブスロット', free: '1', standard: '3', premium: '10' },
  // ===== その他 =====
  { category: 'その他', label: '広告非表示', free: DASH, standard: TICK, premium: TICK },
  { category: 'その他', label: 'プレミアムバッジ', free: DASH, standard: DASH, premium: TICK },
];

/**
 * 比較表をカテゴリ別にグルーピング
 */
export function groupedPlanBenefits(): { category: string; rows: PlanBenefitRow[] }[] {
  const groups = new Map<string, PlanBenefitRow[]>();
  for (const row of PLAN_BENEFITS_TABLE) {
    if (!groups.has(row.category)) groups.set(row.category, []);
    groups.get(row.category)!.push(row);
  }
  return Array.from(groups, ([category, rows]) => ({ category, rows }));
}

// ===================================================================
// プラン紹介・LP 用ハイライト (3 カラム左下の "おすすめポイント")
// ===================================================================

export const PLAN_HIGHLIGHTS: Record<PlanTypeLiteral, string[]> = {
  FREE: [
    'アカウント作成のみで利用可能',
    '基本コンテンツの閲覧',
    'Pui 付与率 ×1.0',
    'プロローグ章の試遊',
  ],
  STANDARD: [
    '会員限定記事 / 動画 (720p)',
    'Pui 付与率 ×1.2',
    '会員価格で物販購入',
    'スタンダード先行予約',
    'コメント投稿',
    '月次ボーナスギフト 1 個',
    '※ 会報誌の送付はありません',
  ],
  PREMIUM: [
    'Pui 付与率 ×2.0 (一番お得)',
    '会報誌を年2回お届け',
    'プレミアム限定コンテンツすべて',
    '動画 1080p 高画質',
    '送料が常時無料',
    'ゲーム通常章が読み放題',
    '月次ボーナスギフト 5 個',
    'プレミアムバッジ',
  ],
};

/**
 * 推奨プラン
 */
export const RECOMMENDED_PLAN: PlanTypeLiteral = 'PREMIUM';
