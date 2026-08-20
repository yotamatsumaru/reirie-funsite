import type { Metadata, Viewport } from 'next';
import { Zen_Kaku_Gothic_New } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/layout/Providers';
import { Sidebar } from '@/components/layout/Sidebar';
import { Footer } from '@/components/layout/Footer';
import { getSiteSectionVisibility, getGameVisibility } from '@/lib/app-setting';
import {
  SITE_NAME,
  SITE_TITLE_DEFAULT,
  SITE_DESCRIPTION,
  hasAnyPubliclyVisibleGame,
} from '@idol/shared';

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
    default: SITE_TITLE_DEFAULT,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#c263a2',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ contentsVisible, productsVisible, dmVisible, gamesVisible }, gameMap] =
    await Promise.all([getSiteSectionVisibility(), getGameVisibility()]);
  // ナビの「ゲーム」は、公開中のゲームが 1 本も無ければ一般会員から隠す。
  // (マスターが ON でも、全ゲームを個別に非公開にしたら /game は空になるため)
  const anyGameVisible = hasAnyPubliclyVisibleGame(gamesVisible, gameMap);
  return (
    <html lang="ja" className={zenKaku.variable}>
      <body className="min-h-screen">
        <Providers>
          <Sidebar
            contentsVisible={contentsVisible}
            productsVisible={productsVisible}
            dmVisible={dmVisible}
            gamesVisible={anyGameVisible}
          />
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
