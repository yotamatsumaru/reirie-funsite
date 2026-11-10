/**
 * Content-Security-Policy の組み立て。
 *
 * - ENFORCED_CSP: いま実際に効かせている方針 (従来どおり)。
 * - REPORT_ONLY_CSP: 将来この内容に締める予定の、より厳しい方針。
 *   ブラウザは違反してもブロックせず /api/csp-report に報告だけ送る。
 *   報告を見て「正当な読み込み」が出なくなったら、こちらを本番の方針に昇格させる。
 *
 * 厳しくした点 (Report-Only 側):
 *   - script-src から 'unsafe-eval' を外す (文字列を JS として実行する経路を塞ぐ)
 *   - connect-src の「https: と wss: なら何処でも」をやめ、実際の接続先だけにする
 *     (XSS が起きても盗んだ情報を任意のサーバーへ送れないようにする)
 *   - img-src / media-src の「https: なら何処でも」を、自サイト・CDN・S3 に絞る
 *   'unsafe-inline' (script) は Next.js が出力するインラインスクリプトに必要なため、
 *   nonce 方式に切り替えるまでは残す。
 */

export const CSP_REPORT_PATH = '/api/csp-report';

const TICKETDIVE = 'https://ticketdive.com https://*.ticketdive.com';
const STRIPE_FRAMES = 'https://js.stripe.com https://hooks.stripe.com';

function hostSource(domain: string | undefined): string[] {
  const d = (domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return d ? [`https://${d}`] : [];
}

export function buildEnforcedCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.stripe.com https://*.amazonaws.com wss: https:",
    // Ticket Dive: お知らせに埋め込む申込タグ (iframe 型) 用。lib/ticket-embed.ts と同じドメイン
    `frame-src 'self' ${STRIPE_FRAMES} ${TICKETDIVE}`,
    "media-src 'self' blob: https:",
    "object-src 'none'",
    "base-uri 'self'",
    // Ticket Dive: お知らせに埋め込む申込タグ (フォーム型) の送信先
    `form-action 'self' ${TICKETDIVE}`,
    "frame-ancestors 'self'",
  ].join('; ');
}

export function buildReportOnlyCsp(opts: {
  videoDomain?: string;
  assetDomain?: string;
}): string {
  const cdn = [...hostSource(opts.videoDomain), ...hostSource(opts.assetDomain)];
  const s3 = 'https://*.amazonaws.com';
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    ['img-src', "'self'", 'data:', 'blob:', ...cdn, s3, 'https://*.stripe.com'].join(' '),
    "font-src 'self' data:",
    // 動画アップロード (S3 署名 URL への PUT)・HLS 再生 (CDN)・Stripe
    ['connect-src', "'self'", 'https://api.stripe.com', s3, ...cdn].join(' '),
    `frame-src 'self' ${STRIPE_FRAMES} ${TICKETDIVE}`,
    ['media-src', "'self'", 'blob:', ...cdn, s3].join(' '),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${TICKETDIVE}`,
    "frame-ancestors 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
    'report-to csp',
  ].join('; ');
}

/** 報告に含まれる URL からクエリと断片を落とす (access_token 等をログに残さない) */
export function stripUrlSecrets(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.slice(0, 500);
  const cut = s.search(/[?#]/);
  return cut >= 0 ? s.slice(0, cut) : s;
}

export type CspViolationSummary = {
  directive: string;
  blocked: string;
  document: string;
  source: string;
  line: number | null;
};

/**
 * 旧形式 (application/csp-report: {"csp-report": {...}}) と
 * 新形式 (application/reports+json: [{type:"csp-violation", body:{...}}]) の両方から要点を抜き出す。
 */
export function summarizeCspReports(payload: unknown): CspViolationSummary[] {
  const bodies: Record<string, unknown>[] = [];
  if (Array.isArray(payload)) {
    for (const r of payload.slice(0, 20)) {
      if (r && typeof r === 'object' && (r as { type?: unknown }).type === 'csp-violation') {
        const b = (r as { body?: unknown }).body;
        if (b && typeof b === 'object') bodies.push(b as Record<string, unknown>);
      }
    }
  } else if (payload && typeof payload === 'object') {
    const b = (payload as Record<string, unknown>)['csp-report'];
    if (b && typeof b === 'object') bodies.push(b as Record<string, unknown>);
  }
  return bodies.map((b) => {
    const line = b['line-number'] ?? b['lineNumber'];
    return {
      directive: String(b['effective-directive'] ?? b['effectiveDirective'] ?? b['violated-directive'] ?? '').slice(0, 100),
      blocked: stripUrlSecrets(b['blocked-uri'] ?? b['blockedURL']),
      document: stripUrlSecrets(b['document-uri'] ?? b['documentURL']),
      source: stripUrlSecrets(b['source-file'] ?? b['sourceFile']),
      line: typeof line === 'number' ? line : null,
    };
  });
}
