import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Zen_Maru_Gothic, Shrikhand } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/layout/Providers';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

// ===== Rosy Twilight タイポグラフィ =====
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-cormorant',
  display: 'swap',
});

const zenMaru = Zen_Maru_Gothic({
  subsets: ['latin'],
  weight: ['500', '700', '900'],
  variable: '--font-zen-maru',
  display: 'swap',
});

const shrikhand = Shrikhand({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-shrikhand',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'ReiRieRoom | REIRIE 公式ファンクラブ',
    template: '%s | ReiRieRoom',
  },
  description:
    'REIRIE（黒宮れい × 金子理江）公式ファンクラブ「ReiRieRoom」。限定コンテンツ・ライブ配信・特典会・先行チケット・公式グッズ。紫水晶の部屋へようこそ。',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4a2d5c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ja"
      className={`${zenMaru.variable} ${cormorant.variable} ${shrikhand.variable}`}
    >
      <body className="min-h-screen flex flex-col">
        <Providers>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
