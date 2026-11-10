import { checkCrossSiteWrite, type CsrfInput } from './csrf';

const BASE = 'https://reirie.com';

function input(over: Partial<Omit<CsrfInput, 'header'>> & { headers?: Record<string, string> } = {}): CsrfInput {
  const headers = Object.fromEntries(
    Object.entries({ host: 'origin-app.reirie.com', 'x-forwarded-host': 'reirie.com', ...(over.headers ?? {}) }).map(
      ([k, v]) => [k.toLowerCase(), v],
    ),
  );
  return {
    method: over.method ?? 'POST',
    pathname: over.pathname ?? '/api/cart',
    hasSessionCookie: over.hasSessionCookie ?? true,
    appBaseUrl: over.appBaseUrl ?? BASE,
    header: (n) => headers[n.toLowerCase()] ?? null,
  };
}

describe('checkCrossSiteWrite', () => {
  it('同じサイトからの書き込みは通す', () => {
    expect(checkCrossSiteWrite(input({ headers: { origin: 'https://reirie.com' } })).ok).toBe(true);
    // www 付きで閲覧中 (X-Forwarded-Host が www)
    expect(
      checkCrossSiteWrite(
        input({ headers: { origin: 'https://www.reirie.com', 'x-forwarded-host': 'www.reirie.com' } }),
      ).ok,
    ).toBe(true);
  });

  it('別サイトからのログイン Cookie 付き書き込みは拒否する', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(checkCrossSiteWrite(input({ method, headers: { origin: 'https://evil.example' } })).ok).toBe(false);
    }
    expect(checkCrossSiteWrite(input({ headers: { origin: 'null' } })).ok).toBe(false);
    // 似たドメイン
    expect(checkCrossSiteWrite(input({ headers: { origin: 'https://reirie.com.evil.example' } })).ok).toBe(false);
  });

  it('Origin が無いときは Sec-Fetch-Site で判定する', () => {
    expect(checkCrossSiteWrite(input({ headers: { 'sec-fetch-site': 'cross-site' } })).ok).toBe(false);
    expect(checkCrossSiteWrite(input({ headers: { 'sec-fetch-site': 'same-origin' } })).ok).toBe(true);
    // どちらも無い (古いブラウザ / サーバー間通信)
    expect(checkCrossSiteWrite(input()).ok).toBe(true);
  });

  it('読み取り (GET/HEAD/OPTIONS) は対象外', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(checkCrossSiteWrite(input({ method, headers: { origin: 'https://evil.example' } })).ok).toBe(true);
    }
  });

  it('ログイン Cookie が無ければ対象外 (なりすます相手がいない)', () => {
    expect(
      checkCrossSiteWrite(input({ hasSessionCookie: false, headers: { origin: 'https://evil.example' } })).ok,
    ).toBe(true);
  });

  it('アプリ (Bearer) / cron (x-cron-secret) は対象外', () => {
    expect(
      checkCrossSiteWrite(input({ headers: { origin: 'https://evil.example', authorization: 'Bearer abc' } })).ok,
    ).toBe(true);
    expect(
      checkCrossSiteWrite(input({ headers: { origin: 'https://evil.example', 'x-cron-secret': 'x' } })).ok,
    ).toBe(true);
  });

  it('外部サービスの受信口は対象外', () => {
    for (const pathname of ['/api/game/webhook', '/api/cron/birthday-mail', '/api/csp-report', '/api/auth/callback/credentials']) {
      expect(checkCrossSiteWrite(input({ pathname, headers: { origin: 'https://evil.example' } })).ok).toBe(true);
    }
  });

  it('API 以外 (ページ) は対象外', () => {
    expect(checkCrossSiteWrite(input({ pathname: '/signin', headers: { origin: 'https://evil.example' } })).ok).toBe(true);
  });
});
