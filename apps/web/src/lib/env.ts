/**
 * 環境変数の集約 (サーバー側のみ参照可)
 */
function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v !== '' ? v : undefined;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',

  appBaseUrl: optional('APP_BASE_URL') ?? 'http://localhost:3000',

  auth: {
    secret: optional('AUTH_SECRET') ?? 'dev-insecure-secret-change-me',
    trustHost: process.env.AUTH_TRUST_HOST === 'true',
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
};
