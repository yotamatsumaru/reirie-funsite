export const PLAN_TYPES = ['FREE', 'STANDARD', 'PREMIUM'] as const;
export type PlanTypeLiteral = (typeof PLAN_TYPES)[number];

export const ACCESS_LEVELS = ['PUBLIC', 'MEMBERS', 'PREMIUM'] as const;
export type AccessLevelLiteral = (typeof ACCESS_LEVELS)[number];

export const BILLING_INTERVALS = ['MONTH', 'YEAR'] as const;
export type BillingIntervalLiteral = (typeof BILLING_INTERVALS)[number];

export const PLAN_LABELS: Record<PlanTypeLiteral, string> = {
  FREE: '無料',
  STANDARD: 'スタンダード',
  PREMIUM: 'プレミアム',
};

export const PLAN_PRICES: Record<PlanTypeLiteral, { monthly: number; yearly: number }> = {
  FREE: { monthly: 0, yearly: 0 },
  STANDARD: { monthly: 980, yearly: 9800 },
  PREMIUM: { monthly: 1980, yearly: 19800 },
};

export const ORDER_STATUS_LABELS = {
  PENDING: '入金待ち',
  PAID: '入金済み',
  PROCESSING: '準備中',
  SHIPPED: '発送済み',
  DELIVERED: '配達完了',
  CANCELED: 'キャンセル',
  REFUNDED: '返金済み',
} as const;

export const TAX_RATE = 0.1; // 10%
export const SHIPPING_FEE_DEFAULT = 600; // 円
export const FREE_SHIPPING_THRESHOLD = 8000; // 円

export const VIDEO_SIGNED_URL_TTL_SEC = 60 * 60 * 4; // 4時間
export const LIVE_SIGNED_URL_TTL_SEC = 60 * 60 * 6; // 6時間
