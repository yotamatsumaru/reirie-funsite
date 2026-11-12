/**
 * 別サイトからの書き込みリクエストを拒否する (CSRF 対策)。
 *
 * ログイン状態は Cookie で持っているため、悪意あるサイトがフォームや fetch で
 * このサイトの API に POST させると、閲覧者のログイン状態のまま書き込みが行われうる
 * (SameSite=Lax の Cookie でも、同じサイト扱いになる経路や古いブラウザでは漏れがある)。
 * proxy.ts で /api/* の書き込み (POST/PUT/PATCH/DELETE) を受けたとき、
 * ブラウザが付ける Origin / Sec-Fetch-Site ヘッダーで送信元を確認する。
 *
 * 通すもの:
 *   - GET / HEAD / OPTIONS (読み取り)
 *   - ログイン Cookie が付いていないリクエスト (なりすます対象が無い)
 *   - Authorization: Bearer / x-cron-secret が付いたリクエスト
 *     (アプリ・Lambda・cron。ブラウザは別サイトからこれらのヘッダーを勝手に付けられない)
 *   - 外部サービスからの受信口 (Stripe Webhook / CSP 違反レポート / cron)
 *   - Origin がこのサイト自身 (表示中のドメイン or APP_BASE_URL)
 *   - Origin が無く Sec-Fetch-Site も cross-site でない (古いブラウザ・同一ページ遷移)
 *
 * 拒否するもの:
 *   - Origin が別サイト / "null" (サンドボックス iframe 等)
 *   - Origin が無く Sec-Fetch-Site: cross-site
 */

export const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 外部サービスから直接呼ばれる受信口 (Cookie を使わず、各ルートが独自に認証する) */
export const CSRF_EXEMPT_PREFIXES = [
  '/api/auth/', // Auth.js (独自の CSRF トークンで保護されている)
  '/api/game/webhook', // Stripe Webhook (署名で検証)
  '/api/cron/', // cron (x-cron-secret で検証)
  '/api/csp-report', // ブラウザが自動送信する CSP 違反レポート (書き込みではなくログのみ)
];

export type CsrfInput = {
  method: string;
  pathname: string;
  /** ヘッダー取得 (小文字名) */
  header: (name: string) => string | null;
  hasSessionCookie: boolean;
  /** APP_BASE_URL (本番の正規 URL) */
  appBaseUrl: string;
};

export type CsrfDecision = { ok: true } | { ok: false; reason: string };

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** このサイトとして受け付ける host の一覧 (表示中のドメイン + APP_BASE_URL) */
function allowedHosts(input: CsrfInput): Set<string> {
  const hosts = new Set<string>();
  // CloudFront → nginx 経由では X-Forwarded-Host に閲覧中のドメインが入る。
  // これらはブラウザが別サイトから書き換えられないヘッダー。
  const fwd = input.header('x-forwarded-host');
  if (fwd) {
    for (const h of fwd.split(',')) {
      const v = h.trim().toLowerCase();
      if (v) hosts.add(v);
    }
  }
  const host = input.header('host');
  if (host) hosts.add(host.trim().toLowerCase());
  const base = hostOf(input.appBaseUrl);
  if (base) hosts.add(base);
  return hosts;
}

export function checkCrossSiteWrite(input: CsrfInput): CsrfDecision {
  if (!UNSAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };
  if (!input.pathname.startsWith('/api/')) return { ok: true };
  if (CSRF_EXEMPT_PREFIXES.some((p) => input.pathname.startsWith(p))) return { ok: true };
  if (!input.hasSessionCookie) return { ok: true };

  const authz = input.header('authorization');
  if (authz && /^Bearer\s+\S+/i.test(authz.trim())) return { ok: true };
  if (input.header('x-cron-secret')) return { ok: true };

  const origin = input.header('origin');
  if (origin) {
    if (origin === 'null') return { ok: false, reason: 'origin null' };
    const h = hostOf(origin);
    if (h && allowedHosts(input).has(h)) return { ok: true };
    return { ok: false, reason: `cross-origin: ${origin}` };
  }

  const site = input.header('sec-fetch-site');
  if (site === 'cross-site') return { ok: false, reason: 'sec-fetch-site: cross-site' };
  return { ok: true };
}
