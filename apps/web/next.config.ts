import type { NextConfig } from 'next';

const cdnAssetDomain = process.env.NEXT_PUBLIC_CLOUDFRONT_ASSET_DOMAIN ?? '';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // モノレポ内の他パッケージを Next.js のビルドターゲットに含める
  transpilePackages: ['@idol/shared', '@idol/db'],
  // EC2 + PM2 配置を想定 (standalone build)
  output: 'standalone',
  experimental: {
    typedRoutes: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co' },
      ...(cdnAssetDomain ? [{ protocol: 'https' as const, hostname: cdnAssetDomain }] : []),
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
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
