/**
 * 環境変数の集約 (サーバー側のみ参照可)
 */
function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v !== '' ? v : undefined;
}

const INSECURE_DEFAULT_SECRET = 'dev-insecure-secret-change-me';
const isProductionEnv = process.env.NODE_ENV === 'production';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: isProductionEnv,

  appBaseUrl: optional('APP_BASE_URL') ?? 'http://localhost:3000',

  /**
   * デモモード: モックデータで UI のみを表示する。
   * - DB / Stripe / CloudFront 等の外部依存を全て無効化
   * - 認証は demo@example.com / admin@example.com の任意パスワードでログイン可能
   */
  demoMode:
    process.env.DEMO_MODE === '1' ||
    process.env.DEMO_MODE === 'true' ||
    process.env.NEXT_PUBLIC_DEMO_MODE === '1' ||
    process.env.NEXT_PUBLIC_DEMO_MODE === 'true',

  auth: {
    secret: optional('AUTH_SECRET') ?? INSECURE_DEFAULT_SECRET,
    trustHost: process.env.AUTH_TRUST_HOST === 'true',
  },

  /**
   * モバイル / ネイティブ (Unity 等) 向け API トークン設定。
   * Web の Cookie セッションとは別に、Bearer トークンで同じ API を叩けるようにする。
   * 署名鍵は AUTH_SECRET を流用 (別管理にしたい場合は API_TOKEN_SECRET を設定)。
   */
  apiToken: {
    secret:
      optional('API_TOKEN_SECRET') ??
      optional('AUTH_SECRET') ??
      INSECURE_DEFAULT_SECRET,
    issuer: optional('API_TOKEN_ISSUER') ?? 'reirie-funsite',
    audience: optional('API_TOKEN_AUDIENCE') ?? 'reirie-api',
    // アクセストークン有効期限 (秒)。既定 1 時間。
    accessTtlSec: Number(optional('API_TOKEN_ACCESS_TTL_SEC') ?? '3600'),
    // リフレッシュトークン有効期限 (秒)。既定 30 日。
    refreshTtlSec: Number(optional('API_TOKEN_REFRESH_TTL_SEC') ?? String(60 * 60 * 24 * 30)),
  },

  database: {
    url: optional('DATABASE_URL'),
  },

  stripe: {
    secretKey: optional('STRIPE_SECRET_KEY') ?? '',
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET') ?? '',
    publishableKey: optional('STRIPE_PUBLISHABLE_KEY') ?? '',
    prices: {
      standardMonthly: optional('STRIPE_PRICE_STANDARD_MONTHLY'),
      standardYearly: optional('STRIPE_PRICE_STANDARD_YEARLY'),
      premiumMonthly: optional('STRIPE_PRICE_PREMIUM_MONTHLY'),
      premiumYearly: optional('STRIPE_PRICE_PREMIUM_YEARLY'),
    },
  },

  aws: {
    region: process.env.AWS_REGION ?? 'ap-northeast-1',
  },

  s3: {
    videoBucket: optional('S3_VIDEO_BUCKET') ?? '',
    assetBucket: optional('S3_ASSET_BUCKET') ?? '',
  },

  cloudfront: {
    videoDomain: optional('CLOUDFRONT_VIDEO_DOMAIN') ?? '',
    assetDomain: optional('CLOUDFRONT_ASSET_DOMAIN') ?? '',
    keyPairId: optional('CLOUDFRONT_KEY_PAIR_ID') ?? '',
    privateKey: optional('CLOUDFRONT_PRIVATE_KEY') ?? '',
  },

  ivs: {
    channelArn: optional('IVS_CHANNEL_ARN') ?? '',
    playbackKeyPairId: optional('IVS_PLAYBACK_KEY_PAIR_ID') ?? '',
    playbackPrivateKey: optional('IVS_PLAYBACK_PRIVATE_KEY') ?? '',
  },

  ses: {
    fromEmail: optional('SES_FROM_EMAIL') ?? 'no-reply@example.com',
  },

  lawson: {
    apiBase: optional('LAWSON_TICKET_API_BASE') ?? '',
    apiKey: optional('LAWSON_TICKET_API_KEY') ?? '',
    partnerId: optional('LAWSON_TICKET_PARTNER_ID') ?? '',
  },

  /**
   * Cron 起動エンドポイント認証用シークレット
   * (月次ボーナスギフト付与等の内部 API で利用)
   */
  cron: {
    secret: optional('CRON_SECRET') ?? '',
  },
};

/**
 * 本番環境で開発用デフォルトシークレットのまま起動していないかを検証する。
 * - AUTH_SECRET / API_TOKEN_SECRET が未設定のまま NODE_ENV=production で起動すると、
 *   セッション JWT / モバイル Bearer トークンの署名鍵が固定の公開値になり、
 *   誰でも有効なトークンを偽造できる致命的な脆弱性になる。
 * - デプロイ起動時 (instrumentation.ts などから) に呼び出し、検出したら即座に落とす。
 */
export function assertProductionSecrets(): void {
  if (!isProductionEnv) return;
  const insecure: string[] = [];
  if (env.auth.secret === INSECURE_DEFAULT_SECRET) insecure.push('AUTH_SECRET');
  if (env.apiToken.secret === INSECURE_DEFAULT_SECRET) insecure.push('API_TOKEN_SECRET / AUTH_SECRET');
  if (insecure.length > 0) {
    throw new Error(
      `[FATAL] 本番環境で開発用デフォルトシークレットが使用されています: ${insecure.join(', ')}。` +
        ' AUTH_SECRET (および必要なら API_TOKEN_SECRET) を必ず環境変数で設定してください。',
    );
  }
}
