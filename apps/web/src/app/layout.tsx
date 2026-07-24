import type { Metadata, Viewport } from 'next';
import { Zen_Kaku_Gothic_New } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/layout/Providers';
import { Sidebar } from '@/components/layout/Sidebar';
import { Footer } from '@/components/layout/Footer';
import { getSiteSectionVisibility } from '@/lib/app-setting';

// ===== City Editorial タイポグラフィ =====
// 旧: Cormorant Garamond（英字セリフ）+ Zen Maru Gothic（丸ゴシック）+ Shrikhand（装飾）
// 新: ゴシック体（ヒラギノ角ゴ 系）に統一。Web フォントは太字表現に強い Zen Kaku Gothic New を採用し、
//     システムのヒラギノ角ゴ ProN / Hiragino Sans をフォールバックとして併用する。
const zenKaku = Zen_Kaku_Gothic_New({
  subsets: ['latin'],
  weight: ['500', '700', '900'],
  variable: '--font-zen-kaku',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'ReiRieRoom | REIRIE 公式ファンクラブ',
    template: '%s | ReiRieRoom',
  },
  description:
    'REIRIE（黒宮れい × 金子理江）公式ファンクラブ「ReiRieRoom」。限定コンテンツ・ライブ配信・特典会・先行チケット・公式グッズ。',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#c263a2',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { contentsVisible, productsVisible } = await getSiteSectionVisibility();
  return (
    <html lang="ja" className={zenKaku.variable}>
      <body className="min-h-screen">
        <Providers>
          <Sidebar contentsVisible={contentsVisible} productsVisible={productsVisible} />
          {/* PC ではサイドバー幅 (w-64 = 16rem) 分だけ右にオフセット */}
          <div className="flex min-h-screen flex-col md:pl-64">
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
