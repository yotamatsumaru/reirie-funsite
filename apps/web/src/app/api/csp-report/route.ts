/**
 * POST /api/csp-report
 *
 * ブラウザが自動送信する CSP 違反レポートの受け口 (Content-Security-Policy-Report-Only)。
 * 何もブロックせず、要点だけをサーバーログ ([csp-report] ...) に残す。
 *
 * - 認証なし (ブラウザが Cookie 無しで勝手に送ってくるため)。CSRF チェックの対象外。
 * - 悪用されてもログが溢れないよう、本文サイズとプロセス全体の記録件数に上限を設ける。
 * - URL のクエリ (access_token など) はログに残さない。
 */
import { summarizeCspReports } from '@/lib/csp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;
/** 1 分あたりにログへ書く最大件数 (超えた分は数だけ数えて捨てる) */
const MAX_LOGS_PER_MINUTE = 60;

const state = { windowStart: 0, logged: 0, dropped: 0 };

function noContent() {
  return new Response(null, { status: 204 });
}

export async function POST(req: Request) {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_BODY_BYTES) return noContent();

  let text: string;
  try {
    text = await req.text();
  } catch {
    return noContent();
  }
  if (text.length > MAX_BODY_BYTES) return noContent();

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return noContent();
  }

  const now = Date.now();
  if (now - state.windowStart > 60_000) {
    if (state.dropped > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[csp-report] dropped ${state.dropped} reports in the last window`);
    }
    state.windowStart = now;
    state.logged = 0;
    state.dropped = 0;
  }

  for (const v of summarizeCspReports(payload)) {
    if (state.logged >= MAX_LOGS_PER_MINUTE) {
      state.dropped++;
      continue;
    }
    state.logged++;
    // eslint-disable-next-line no-console
    console.warn(
      `[csp-report] ${v.directive} blocked=${v.blocked || '-'} page=${v.document || '-'}` +
        (v.source ? ` src=${v.source}${v.line != null ? `:${v.line}` : ''}` : ''),
    );
  }
  return noContent();
}
