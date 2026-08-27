export const PLAN_TYPES = ['FREE', 'STANDARD', 'PREMIUM'] as const;
export type PlanTypeLiteral = (typeof PLAN_TYPES)[number];

/**
 * 公開範囲 (Prisma AccessLevel enum と同期)。制限が緩い順に並べる。
 *
 *  - PUBLIC       : だれでも       (未ログインでも閲覧可)
 *  - FREE_MEMBERS : 無料会員以上   (ログインしていれば無料プランでも閲覧可)
 *  - MEMBERS      : 会員限定       (スタンダード以上。無料会員は閲覧不可)
 *  - PREMIUM      : プレミアム限定 (プレミアムのみ)
 *
 * 並び順は管理画面の select の選択肢順としてもそのまま使うので、
 * 「緩い→厳しい」の順序を崩さないこと。
 */
export const ACCESS_LEVELS = ['PUBLIC', 'FREE_MEMBERS', 'MEMBERS', 'PREMIUM'] as const;
export type AccessLevelLiteral = (typeof ACCESS_LEVELS)[number];

/**
 * 管理画面・会員画面で共通して使う公開範囲のラベル。
 *
 * かつては画面ごとにラベルをベタ書きしていたため、同じ MEMBERS を
 * 「会員（無料プラン以上）」と書く画面と「会員限定（スタンダード以上）」と
 * 書く画面が混在し、実装 (canAccess) と食い違っていた。
 * 表示名は必ずここを参照すること。
 */
export const ACCESS_LEVEL_LABELS: Record<AccessLevelLiteral, string> = {
  PUBLIC: 'だれでも',
  FREE_MEMBERS: '無料会員以上',
  MEMBERS: '会員限定',
  PREMIUM: 'プレミアム限定',
};

/** 選択時に迷わないための補足説明 (select の hint やヘルプに使う)。 */
export const ACCESS_LEVEL_DESCRIPTIONS: Record<AccessLevelLiteral, string> = {
  PUBLIC: '未ログインの人も視聴できます',
  FREE_MEMBERS: 'ログインしている会員なら無料プランでも視聴できます',
  MEMBERS: 'スタンダード以上の有料会員のみ視聴できます',
  PREMIUM: 'プレミアム会員のみ視聴できます',
};

export function accessLevelLabel(level: AccessLevelLiteral | string): string {
  return ACCESS_LEVEL_LABELS[level as AccessLevelLiteral] ?? level;
}

/**
 * ユーザーロール (Prisma UserRole enum と同期)
 *  - USER:        通常会員
 *  - ADMIN:       運営編集者 (コンテンツ・商品・ゲーム編集権限)
 *  - STAFF:       スタッフ管理者。SUPER_ADMIN と同じ管理画面を「閲覧」できるが、
 *                 返金 / BAN / ロール変更などの書き込み操作はできない (read-only 運営)。
 *  - SUPER_ADMIN: システム最高権限 (KPI / 課金 / ユーザー BAN / 管理者管理 / 監査)
 */
export const USER_ROLES = ['USER', 'ADMIN', 'STAFF', 'SUPER_ADMIN'] as const;
export type UserRoleLiteral = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRoleLiteral, string> = {
  USER: '一般会員',
  ADMIN: '管理者',
  STAFF: 'スタッフ管理者',
  SUPER_ADMIN: 'スーパー管理者',
};

/** ロール階層: SUPER_ADMIN > STAFF > ADMIN > USER */
const ROLE_RANK: Record<UserRoleLiteral, number> = {
  USER: 0,
  ADMIN: 1,
  STAFF: 2,
  SUPER_ADMIN: 3,
};

export function hasRoleAtLeast(
  userRole: UserRoleLiteral | undefined | null,
  required: UserRoleLiteral,
): boolean {
  if (!userRole) return false;
  return ROLE_RANK[userRole] >= ROLE_RANK[required];
}

export function isAdmin(role: UserRoleLiteral | undefined | null): boolean {
  return hasRoleAtLeast(role, 'ADMIN');
}

export function isSuperAdmin(role: UserRoleLiteral | undefined | null): boolean {
  return role === 'SUPER_ADMIN';
}

/** スタッフ管理者か (SUPER_ADMIN と同じ画面を閲覧できるが書き込み不可)。 */
export function isStaff(role: UserRoleLiteral | undefined | null): boolean {
  return role === 'STAFF';
}

/**
 * スーパー管理画面 (/super-admin) を「閲覧」できるか。
 *  - SUPER_ADMIN: 閲覧＋操作すべて可
 *  - STAFF:       閲覧のみ (書き込み操作は個別に requireSuperAdmin で拒否)
 */
export function canViewSuperAdmin(role: UserRoleLiteral | undefined | null): boolean {
  return role === 'SUPER_ADMIN' || role === 'STAFF';
}

/**
 * 管理権限 (Admin Capability)
 *  - ADMIN ロールに対して、領域ごとに付与する細分化された権限。
 *  - SUPER_ADMIN は常にすべての権限を持つ (個別付与不要)。
 *  - User.adminCapabilities (string[]) に保持する。
 *
 *  CONTENT: コンテンツ / 動画 / ライブ配信の管理
 *  MERCH:   グッズ(商品) / 在庫 / 注文の管理
 *  GAME:    恋愛ゲーム(キャラ/シナリオ/アイテム/プレイヤー)の管理
 *  CALL:    1on1コール / 特典会イベントの管理
 */
export const ADMIN_CAPABILITIES = ['CONTENT', 'MERCH', 'GAME', 'CALL'] as const;
export type AdminCapabilityLiteral = (typeof ADMIN_CAPABILITIES)[number];

export const ADMIN_CAPABILITY_LABELS: Record<AdminCapabilityLiteral, string> = {
  CONTENT: 'コンテンツ',
  MERCH: 'グッズ・EC',
  GAME: 'ゲーム',
  CALL: '1on1コール',
};

export const ADMIN_CAPABILITY_DESCRIPTIONS: Record<AdminCapabilityLiteral, string> = {
  CONTENT: 'ブログ・ギャラリー・動画・ライブ配信の管理',
  MERCH: '商品(グッズ)・在庫・注文の管理',
  GAME: '恋愛ゲームのキャラ・シナリオ・アイテム・プレイヤーの管理',
  CALL: '1on1コール・特典会イベントの管理',
};

/** 文字列配列を AdminCapabilityLiteral[] に正規化（未知の値は除外） */
export function normalizeAdminCapabilities(
  values: readonly string[] | undefined | null,
): AdminCapabilityLiteral[] {
  if (!values) return [];
  const set = new Set<AdminCapabilityLiteral>();
  for (const v of values) {
    if ((ADMIN_CAPABILITIES as readonly string[]).includes(v)) {
      set.add(v as AdminCapabilityLiteral);
    }
  }
  // 定義順に整列
  return ADMIN_CAPABILITIES.filter((c) => set.has(c));
}

/**
 * ユーザーが指定の管理権限を持つか判定する。
 *  - SUPER_ADMIN は常に true
 *  - ADMIN は adminCapabilities に含まれていれば true
 *  - それ以外 (USER) は false
 */
export function hasCapability(
  params: {
    role: UserRoleLiteral | undefined | null;
    capabilities?: readonly string[] | null;
  },
  required: AdminCapabilityLiteral,
): boolean {
  if (params.role === 'SUPER_ADMIN') return true;
  if (params.role !== 'ADMIN') return false;
  return (params.capabilities ?? []).includes(required);
}

/** ユーザーが「いずれかの管理領域」にアクセスできるか (管理画面の入口判定) */
export function hasAnyCapability(params: {
  role: UserRoleLiteral | undefined | null;
  capabilities?: readonly string[] | null;
}): boolean {
  if (params.role === 'SUPER_ADMIN') return true;
  if (params.role !== 'ADMIN') return false;
  return (params.capabilities ?? []).length > 0;
}

export const BILLING_INTERVALS = ['MONTH', 'YEAR'] as const;
export type BillingIntervalLiteral = (typeof BILLING_INTERVALS)[number];

export const PLAN_LABELS: Record<PlanTypeLiteral, string> = {
  FREE: '無料',
  STANDARD: 'スタンダード',
  PREMIUM: 'プレミアム',
};

/**
 * プラン価格 (税込・円)。
 *
 * 2026-06-26 改定 (3 プラン体制):
 *  - FREE     : 無料
 *  - STANDARD : 月額 ¥666 (月額課金のみ)
 *  - PREMIUM  : 年額 ¥7,920 (年額課金のみ・会報誌 年2回 / ポイント付与率最高)
 *
 * monthly / yearly はどちらも保持するが、実際に提供する課金サイクルは
 * PLAN_BILLING_INTERVAL を参照すること。
 *  - STANDARD は月額のみ (yearly は月額×12 の参考値)。
 *  - PREMIUM は年額のみ (monthly は年額÷12 の参考値・端数切り上げ)。
 */
export const PLAN_PRICES: Record<PlanTypeLiteral, { monthly: number; yearly: number }> = {
  FREE: { monthly: 0, yearly: 0 },
  STANDARD: { monthly: 666, yearly: 666 * 12 },
  PREMIUM: { monthly: Math.ceil(7920 / 12), yearly: 7920 },
};

/**
 * 各プランで実際に提供する課金サイクル。
 *  - FREE     : null (課金なし)
 *  - STANDARD : 'MONTH' (月額)
 *  - PREMIUM  : 'YEAR'  (年額)
 */
export const PLAN_BILLING_INTERVAL: Record<PlanTypeLiteral, BillingIntervalLiteral | null> = {
  FREE: null,
  STANDARD: 'MONTH',
  PREMIUM: 'YEAR',
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

/**
 * Payment.kind (決済の種別) の日本語表示ラベル。
 *  - SUBSCRIPTION:   月額/年額サブスクリプション課金
 *  - ONE_TIME_ORDER: EC (グッズ) の単発注文決済
 *  - TICKET_FEE:     1on1コール/特典会などのチケット代
 */
export const PAYMENT_KIND_LABELS = {
  SUBSCRIPTION: 'サブスク',
  ONE_TIME_ORDER: 'EC注文',
  TICKET_FEE: 'チケット代',
} as const;

/** Payment.status (決済の状態) の日本語表示ラベル */
export const PAYMENT_STATUS_LABELS = {
  PENDING: '処理中',
  SUCCEEDED: '成功',
  FAILED: '失敗',
  REFUNDED: '返金済み',
} as const;

export const TAX_RATE = 0.1; // 10%
export const SHIPPING_FEE_DEFAULT = 600; // 円
export const FREE_SHIPPING_THRESHOLD = 8000; // 円

export const VIDEO_SIGNED_URL_TTL_SEC = 60 * 60 * 4; // 4時間
export const LIVE_SIGNED_URL_TTL_SEC = 60 * 60 * 6; // 6時間

/**
 * サイト名・SEO メタ情報の共通定数。
 *
 * トップページ (root layout の metadata) とメンテナンスページで同じ値を使うことで、
 * メンテナンス中でも <title> やサイトタイトルが変わらないようにする
 * (メンテナンス中も SEO タイトルを固定するため)。
 *
 *  - SITE_NAME:           サイト略称 (title テンプレートのサフィックス等に使用)
 *  - SITE_TITLE_DEFAULT:  ページ側で title を指定しない場合の既定タイトル (トップと共通)
 *  - SITE_DESCRIPTION:    既定の meta description
 */
export const SITE_NAME = 'ReiRieRoom';
export const SITE_TITLE_DEFAULT = 'ReiRieRoom | REIRIE 公式ファンクラブ';
export const SITE_DESCRIPTION =
  'REIRIE（黒宮れい × 金子理江）公式ファンクラブ「ReiRieRoom」。限定コンテンツ・ライブ配信・特典会・先行チケット・公式グッズ。';

/** 都道府県一覧 (会員登録・配送先などの住所入力で共通利用) */
export const PREFECTURES = [
  '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県',
  '埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県',
  '岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
  '鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県',
  '佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
] as const;
export type Prefecture = (typeof PREFECTURES)[number];
