#!/usr/bin/env node
/**
 * モバイル(375px幅)での横スクロール発生チェック
 * - 各 URL について document.documentElement.scrollWidth が viewport より大きいか確認
 * - 横スクロールが発生する要素を特定
 */
// pnpm hoisted: 絶対パスでimport
const { chromium, devices } = await import(
  '/home/user/webapp/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs'
);

const BASE = process.env.BASE_URL || 'http://localhost:3000';

// デモモードでログインしたいページは super_email を立てる
const PAGES = [
  // 公開ページ
  { path: '/', name: 'TOP' },
  { path: '/contents', name: 'コンテンツ一覧' },
  { path: '/products', name: 'グッズ一覧' },
  { path: '/game', name: 'ゲームTOP' },
  { path: '/plans', name: 'プラン' },
  { path: '/cart', name: 'カート' },
  { path: '/signin', name: 'サインイン' },
  { path: '/signup', name: 'サインアップ' },
  { path: '/notices', name: 'お知らせ一覧' },
  { path: '/maintenance', name: 'メンテナンス' },
  // 認証必須(super)
  { path: '/me', name: 'マイページ', auth: 'super' },
  { path: '/admin', name: '管理TOP', auth: 'super' },
  { path: '/admin/orders', name: '管理-注文', auth: 'super' },
  { path: '/admin/products', name: '管理-商品', auth: 'super' },
  { path: '/admin/contents', name: '管理-コンテンツ', auth: 'super' },
  { path: '/admin/videos', name: '管理-動画', auth: 'super' },
  { path: '/admin/live', name: '管理-ライブ', auth: 'super' },
  { path: '/admin/game/characters', name: '管理-キャラ', auth: 'super' },
  { path: '/admin/game/scenarios', name: '管理-シナリオ', auth: 'super' },
  { path: '/admin/game/items', name: '管理-アイテム', auth: 'super' },
  { path: '/admin/game/players', name: '管理-プレイヤー', auth: 'super' },
  // super-admin
  { path: '/super-admin', name: 'SA-ダッシュボード', auth: 'super' },
  { path: '/super-admin/users', name: 'SA-ユーザー', auth: 'super' },
  { path: '/super-admin/subscriptions', name: 'SA-サブスク', auth: 'super' },
  { path: '/super-admin/orders', name: 'SA-注文売上', auth: 'super' },
  { path: '/super-admin/game', name: 'SA-ゲーム経済', auth: 'super' },
  { path: '/super-admin/announcements', name: 'SA-お知らせ', auth: 'super' },
  { path: '/super-admin/settings', name: 'SA-設定', auth: 'super' },
  { path: '/super-admin/audit', name: 'SA-監査ログ', auth: 'super' },
  { path: '/super-admin/admins', name: 'SA-管理者', auth: 'super' },
];

async function signIn(context, email) {
  // CSRF + credentials POST を直接叩いてセッションクッキーを取得
  const apiCtx = context.request;
  const csrfRes = await apiCtx.get(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  await apiCtx.post(`${BASE}/api/auth/callback/credentials`, {
    form: {
      email,
      password: 'demo',
      csrfToken,
      callbackUrl: `${BASE}/super-admin`,
    },
  });
  // 確認
  const sess = await apiCtx.get(`${BASE}/api/auth/session`);
  const s = await sess.json();
  console.error(`signed in as ${s?.user?.email} role=${s?.user?.role}`);
}

(async () => {
  // headless-shell が V8 snapshot 問題でクラッシュするので、フル chromium を直接指定
  const fs = await import('node:fs');
  const candidates = [
    '/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
    '/home/user/.cache/ms-playwright/chromium-1217/chrome-linux/chrome',
  ];
  const execPath = candidates.find((p) => fs.existsSync(p));
  const browser = await chromium.launch({
    executablePath: execPath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // 1) ゲスト context
  const guestCtx = await browser.newContext({
    ...devices['iPhone SE'],
    viewport: { width: 375, height: 667 },
  });

  // 2) super context
  const superCtx = await browser.newContext({
    ...devices['iPhone SE'],
    viewport: { width: 375, height: 667 },
  });
  await signIn(superCtx, 'super@example.com');

  console.log(`\nBASE = ${BASE}`);
  console.log('viewport = 375x667 (iPhone SE)\n');
  console.log(
    'STATUS  | OVF  | docW | bodyW | offenders (top 3)         | PAGE',
  );
  console.log('-'.repeat(110));

  const issues = [];
  for (const p of PAGES) {
    const ctx = p.auth === 'super' ? superCtx : guestCtx;
    const page = await ctx.newPage();
    try {
      const res = await page.goto(`${BASE}${p.path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      const status = res?.status() ?? 0;
      // 画像など遅延読み込みを少し待つ
      await page.waitForTimeout(700);

      const result = await page.evaluate(() => {
        const docW = document.documentElement.scrollWidth;
        const bodyW = document.body.scrollWidth;
        const winW = window.innerWidth;
        const offenders = [];
        // ビューポートより右にはみ出している要素を特定
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const r = el.getBoundingClientRect();
          if (r.right - winW > 1 && r.width > 0 && r.height > 0) {
            // 子要素のせいで親も hit するので、子要素ではない場合だけ記録
            const tag = el.tagName.toLowerCase();
            const cls = (el.className && typeof el.className === 'string'
              ? el.className.slice(0, 30)
              : ''
            ).replace(/\s+/g, ' ');
            offenders.push({
              tag,
              cls,
              w: Math.round(r.width),
              right: Math.round(r.right),
            });
          }
        }
        // 上位のはみ出し
        offenders.sort((a, b) => b.right - a.right);
        return { docW, bodyW, winW, offenders: offenders.slice(0, 3) };
      });

      const overflow = result.docW > result.winW + 1;
      const flag = overflow ? '⚠️ OVF' : '  OK  ';
      const off = result.offenders
        .map((o) => `${o.tag}.${o.cls}=${o.w}`)
        .join(', ');
      const offTrim = off.length > 60 ? off.slice(0, 60) + '…' : off;
      console.log(
        `${status} ${flag} | ${overflow ? 'YES' : ' no'} | ${String(
          result.docW,
        ).padStart(4)} | ${String(result.bodyW).padStart(5)} | ${offTrim.padEnd(60)} | ${p.path}`,
      );
      if (overflow) issues.push({ path: p.path, name: p.name, ...result });
    } catch (e) {
      console.log(`ERR    | --- | ---- | ----- | ${e.message.slice(0, 60).padEnd(60)} | ${p.path}`);
    } finally {
      await page.close();
    }
  }

  console.log('\n');
  console.log(`Total: ${PAGES.length} pages, ${issues.length} with overflow.`);
  if (issues.length > 0) {
    console.log('\n=== Detailed offenders ===');
    for (const i of issues) {
      console.log(`\n[${i.path}] docW=${i.docW} winW=${i.winW}`);
      for (const o of i.offenders) {
        console.log(`  ${o.tag}.${o.cls} w=${o.w} right=${o.right}`);
      }
    }
  }

  await browser.close();
  process.exit(issues.length === 0 ? 0 : 1);
})();
