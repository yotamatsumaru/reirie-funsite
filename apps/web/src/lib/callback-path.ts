/**
 * ログイン後の遷移先 (callbackUrl) を安全なローカルパスに正規化する。
 * クライアント (SignInForm) とサーバー (/signin ページ) の両方で使う。
 *
 * - 未指定 / 空 / トップ ("/") → マイページ ("/me")
 * - "//evil.com" や "http(s)://..." などの外部サイトへの遷移 (オープンリダイレクト) は "/me" へ
 *   (自サイトの絶対 URL が渡された場合は pathname + search だけを使う)
 * - "/signin" 自身や認証系ページへ戻すとログイン画面がループするため "/me" へ
 */
const FALLBACK = '/me';
const AUTH_PAGES = ['/signin', '/signup', '/verify-email', '/forgot-password', '/reset-password'];

export function resolveCallbackPath(
  raw: string | null | undefined,
  /** 絶対 URL を受け付けるときの自サイトの origin (省略時は絶対 URL は全て拒否) */
  selfOrigin?: string,
): string {
  if (!raw) return FALLBACK;
  let value = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      const u = new URL(value);
      if (!selfOrigin || u.origin !== new URL(selfOrigin).origin) return FALLBACK;
      value = `${u.pathname}${u.search}${u.hash}`;
    } catch {
      return FALLBACK;
    }
  }
  // 単一スラッシュ始まりのローカルパスのみ (バックスラッシュも外部扱いになるブラウザがあるので拒否)
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return FALLBACK;
  const path = value.split(/[?#]/)[0];
  if (path === '/') return FALLBACK;
  if (AUTH_PAGES.some((p) => path === p || path.startsWith(`${p}/`))) return FALLBACK;
  return value;
}
