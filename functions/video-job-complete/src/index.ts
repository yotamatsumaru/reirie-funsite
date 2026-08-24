/**
 * MediaConvert Job State Change → Web API 通知ブリッジ Lambda
 * =============================================================
 *
 * ## 役割
 *   EventBridge の "MediaConvert Job State Change" イベントを受け取り、
 *   COMPLETE / ERROR のときだけ Web アプリの
 *     POST {WEB_APP_BASE_URL}/api/admin/videos/job-complete
 *   を叩いて、対象 Video を READY / FAILED に確定させる。
 *
 * ## なぜ Lambda を挟むのか
 *   - MediaConvert は完了を「push」で教えてくれないため、EventBridge の
 *     ジョブ状態変化イベントを唯一の完了トリガーとして使う。
 *   - EventBridge から HTTPS を直接叩く (API destinations) 構成も可能だが、
 *     ヘッダ (x-cron-secret) 付与・payload 整形・尺の抽出・ログを
 *     コードで持てる Lambda 経由の方が運用しやすい。
 *
 * ## 認証
 *   Web API は `x-cron-secret` ヘッダが CRON_SECRET と一致することを要求する。
 *   この Lambda は環境変数 CRON_SECRET を保持し、リクエストに付与する。
 *
 * ## 必要な環境変数
 *   - WEB_APP_BASE_URL : 例 https://reirie.com  (末尾スラッシュは不要)
 *   - CRON_SECRET      : Web の CRON_SECRET と同じ値
 *       もしくは
 *     CRON_SECRET_PARAM : SSM SecureString のパラメータ名
 *       (CloudFormation は Lambda 環境変数に SecureString の「値」を
 *        埋め込めないため、CDK からは名前だけを渡し、実行時に取得する)
 *   - (任意) JOB_COMPLETE_PATH : 既定 /api/admin/videos/job-complete
 *   - (任意) REQUEST_TIMEOUT_MS : 既定 8000
 *
 * ## トリガー (EventBridge ルール例)
 *   event pattern:
 *     {
 *       "source": ["aws.mediaconvert"],
 *       "detail-type": ["MediaConvert Job State Change"],
 *       "detail": { "status": ["COMPLETE", "ERROR"] }
 *     }
 *   ※ ルール側で status を絞っても、本 Lambda は二重に判定するので安全。
 *
 * ## 注意
 *   AWS SDK には依存しない (fetch で Web API を叩くだけ)。Node.js 20 ランタイムの
 *   グローバル fetch を使用する。DB や Prisma エンジンの同梱も不要なので ZIP は軽量。
 */
import type { Context, EventBridgeEvent } from 'aws-lambda';
import {
  parseMediaConvertEvent,
  type JobCompletePayload,
  type MediaConvertEvent,
  type MediaConvertJobDetail,
} from './parse-event';

type EbEvent = EventBridgeEvent<'MediaConvert Job State Change', MediaConvertJobDetail>;

interface HandlerResult {
  ok: boolean;
  action: 'forwarded' | 'ignored' | 'error';
  reason?: string;
  status?: number;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`missing required env: ${name}`);
  }
  return v;
}

/**
 * CRON_SECRET を解決する。
 *
 * 1. 環境変数 CRON_SECRET があればそれを使う (手動デプロイ / ローカル)
 * 2. なければ CRON_SECRET_PARAM の名前で SSM SecureString から取得する
 *    (CDK デプロイ時はこちら。CFn が SecureString の値を環境変数へ
 *     埋め込めないため名前渡しになる)
 *
 * SSM の値はコンテナ再利用中キャッシュするので API 呼び出しは実質 1 回。
 */
let _cachedCronSecret: string | null = null;

async function resolveCronSecret(): Promise<string> {
  const direct = process.env.CRON_SECRET;
  if (direct) return direct;

  if (_cachedCronSecret) return _cachedCronSecret;

  const paramName = process.env.CRON_SECRET_PARAM;
  if (!paramName) {
    throw new Error('missing required env: CRON_SECRET or CRON_SECRET_PARAM');
  }

  // @aws-sdk/client-ssm は Lambda Node.js 20 ランタイムに同梱されているため
  // バンドルには含めない (esbuild の --external:@aws-sdk/*)。
  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const ssm = new SSMClient({});
  const res = await ssm.send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true }),
  );
  const value = res.Parameter?.Value;
  if (!value) {
    throw new Error(`ssm parameter has no value: ${paramName}`);
  }
  _cachedCronSecret = value;
  return value;
}

function buildUrl(): string {
  const base = requiredEnv('WEB_APP_BASE_URL').replace(/\/+$/, '');
  const path = process.env.JOB_COMPLETE_PATH ?? '/api/admin/videos/job-complete';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

async function postJobComplete(payload: JobCompletePayload): Promise<number> {
  const url = buildUrl();
  const cronSecret = await resolveCronSecret();
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS ?? '8000');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': cronSecret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    // レスポンス本文はログのために読むが、失敗時のみ内容を出す
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(
        '[video-job-complete] web API returned non-2xx',
        res.status,
        text.slice(0, 500),
      );
    }
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}

export const handler = async (
  event: EbEvent,
  _ctx: Context,
): Promise<HandlerResult> => {
  const start = Date.now();

  const parsed = parseMediaConvertEvent(event as unknown as MediaConvertEvent);

  if (parsed.kind === 'ignore') {
    // eslint-disable-next-line no-console
    console.log('[video-job-complete] ignored', parsed.reason);
    return { ok: true, action: 'ignored', reason: parsed.reason };
  }

  const { payload } = parsed;
  try {
    const status = await postJobComplete(payload);
    const elapsed = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(
      '[video-job-complete] forwarded',
      `videoId=${payload.videoId ?? '-'}`,
      `jobId=${payload.jobId}`,
      `mcStatus=${payload.status}`,
      `httpStatus=${status}`,
      `${elapsed}ms`,
    );

    // 2xx 以外は例外にして Lambda を失敗扱いにする → EventBridge のリトライ / DLQ に乗る
    if (status < 200 || status >= 300) {
      throw new Error(`web_api_status_${status}`);
    }
    return { ok: true, action: 'forwarded', status };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[video-job-complete] forward failed', (err as Error).message);
    // 失敗を throw して Lambda を error 終了させる (再試行 / DLQ 用)
    throw err;
  }
};
