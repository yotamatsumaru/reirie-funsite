import type { NextConfig } from 'next';

const cdnAssetDomain = process.env.NEXT_PUBLIC_CLOUDFRONT_ASSET_DOMAIN ?? '';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // モノレポ内の他パッケージを Next.js のビルドターゲットに含める
  transpilePackages: ['@idol/shared', '@idol/db'],
  // EC2 + PM2 配置を想定 (standalone build)
  output: 'standalone',
  // pdfkit を Next のバンドル対象から外し、実行時に node_modules から require させる。
  //   pdfkit は標準フォントのメトリクス (js/data/*.afm) を
  //   `fs.readFileSync(__dirname + '/data/Helvetica.afm')` のように
  //   「実行時の文字列パス」で読み込む。output:'standalone' の依存トレーサは
  //   静的 require で参照されないこの .afm データ群を .next/standalone へ
  //   コピーしないため、本番では Helvetica.afm が ENOENT となり
  //   支払明細書 PDF の生成が INTERNAL_ERROR で失敗していた。
  //   serverExternalPackages に指定すると pdfkit はバンドルされず、
  //   パッケージ一式 (data/ 含む) が node_modules ごとトレース対象になる。
  serverExternalPackages: ['pdfkit'],
  experimental: {
    typedRoutes: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co' },
      ...(cdnAssetDomain ? [{ protocol: 'https' as const, hostname: cdnAssetDomain }] : []),
    ],
    // Next.js 16 で追加されたローカル画像の許可リスト。
    // サイト画像 (super-admin からアップロードした画像。S3未設定時のDBフォールバック配信) は
    // /api/media/site-image/{id}?v=<updatedAt> のようにキャッシュバスター用のクエリ文字列を
    // 付与するため、これを明示的に許可しないと Image コンポーネントがエラーを throw し、
    // 該当ページ (トップページ等) の SSR ごと落ちてしまう。
    // ※ `search` は「省略 (undefined)」にすることで任意のクエリ文字列を許可する
    //   (空文字 '' を指定すると「クエリ文字列が無い場合のみ許可」になり、
    //    ?v=... 付きの実際の URL にマッチしなくなるため注意)。
    localPatterns: [
      { pathname: '/api/media/site-image/**' },
      { pathname: '/api/media/product-image/**' },
      { pathname: '/api/media/game-audio/**' },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // 1on1 通話機能用にカメラ・マイクを同一オリジンで許可する
          // self = このサイト自身。クロスオリジン埋め込みは引き続き不可。
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
          // Content-Security-Policy: XSS の実害範囲を限定する多層防御。
          // - Stripe.js / IVS プレイヤー等が要求する接続先のみ許可
          // - unsafe-inline は Next.js のインラインスタイル/一部スクリプトのために必要最小限で許可
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://api.stripe.com https://*.amazonaws.com wss: https:",
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
              "media-src 'self' blob: https:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
