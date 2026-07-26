/**
 * EventBridge の "MediaConvert Job State Change" イベントを、
 * Web API (/api/admin/videos/job-complete) が期待する payload へ変換する純粋関数群。
 *
 * ここは AWS SDK にもネットワークにも依存しないため、単体テストしやすい。
 *
 * ## MediaConvert Job State Change イベントの形 (抜粋)
 * {
 *   "source": "aws.mediaconvert",
 *   "detail-type": "MediaConvert Job State Change",
 *   "detail": {
 *     "status": "COMPLETE" | "ERROR" | "PROGRESSING" | "SUBMITTED" | "STATUS_UPDATE" | ...,
 *     "jobId": "1700000000000-abcdef",
 *     "userMetadata": { "videoId": "<cuid>" },
 *     "errorCode": 1404,
 *     "errorMessage": "...",
 *     "outputGroupDetails": [
 *       { "outputDetails": [ { "durationInMs": 123456 } ] }
 *     ]
 *   }
 * }
 */

/** MediaConvert のジョブステータス (必要なものだけ列挙、その他は string で受ける)。 */
export type MediaConvertStatus =
  | 'SUBMITTED'
  | 'PROGRESSING'
  | 'STATUS_UPDATE'
  | 'COMPLETE'
  | 'CANCELED'
  | 'ERROR'
  | string;

/** EventBridge イベントの detail 部分 (使うフィールドのみ)。 */
export interface MediaConvertJobDetail {
  status?: MediaConvertStatus;
  jobId?: string;
  userMetadata?: Record<string, string> | null;
  errorCode?: number | string;
  errorMessage?: string;
  outputGroupDetails?: Array<{
    outputDetails?: Array<{ durationInMs?: number }>;
  }>;
}

/** EventBridge イベント本体 (使うフィールドのみ)。 */
export interface MediaConvertEvent {
  source?: string;
  'detail-type'?: string;
  detail?: MediaConvertJobDetail;
}

/** Web API /api/admin/videos/job-complete が受け取る body。 */
export interface JobCompletePayload {
  jobId: string;
  status: 'COMPLETE' | 'ERROR';
  videoId?: string;
  durationSeconds?: number;
  errorMessage?: string;
}

export type ParseResult =
  | { kind: 'forward'; payload: JobCompletePayload }
  | { kind: 'ignore'; reason: string };

/**
 * EventBridge の MediaConvert イベントを解析し、
 * Web API へ転送すべきかどうかを判定する。
 *
 * - COMPLETE / ERROR のみ転送対象 (それ以外の中間状態は ignore)。
 * - jobId が無ければ ignore。
 * - COMPLETE の場合、outputGroupDetails から動画尺 (秒) を推定して付与する。
 */
export function parseMediaConvertEvent(event: MediaConvertEvent): ParseResult {
  if (event?.source && event.source !== 'aws.mediaconvert') {
    return { kind: 'ignore', reason: `unexpected_source:${event.source}` };
  }

  const detail = event?.detail;
  if (!detail) {
    return { kind: 'ignore', reason: 'missing_detail' };
  }

  const status = detail.status;
  if (status !== 'COMPLETE' && status !== 'ERROR') {
    return { kind: 'ignore', reason: `non_terminal_status:${status ?? 'unknown'}` };
  }

  const jobId = detail.jobId;
  if (!jobId) {
    return { kind: 'ignore', reason: 'missing_jobId' };
  }

  const videoId =
    detail.userMetadata && typeof detail.userMetadata.videoId === 'string'
      ? detail.userMetadata.videoId
      : undefined;

  if (status === 'ERROR') {
    const errorMessage = buildErrorMessage(detail);
    return {
      kind: 'forward',
      payload: {
        jobId,
        status: 'ERROR',
        ...(videoId ? { videoId } : {}),
        ...(errorMessage ? { errorMessage } : {}),
      },
    };
  }

  // COMPLETE
  const durationSeconds = extractDurationSeconds(detail);
  return {
    kind: 'forward',
    payload: {
      jobId,
      status: 'COMPLETE',
      ...(videoId ? { videoId } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    },
  };
}

/** errorCode / errorMessage を 1000 文字以内の説明にまとめる。 */
export function buildErrorMessage(detail: MediaConvertJobDetail): string | undefined {
  const parts: string[] = [];
  if (detail.errorCode !== undefined && detail.errorCode !== null) {
    parts.push(`code=${detail.errorCode}`);
  }
  if (detail.errorMessage) {
    parts.push(detail.errorMessage);
  }
  if (parts.length === 0) return undefined;
  return parts.join(' ').slice(0, 1000);
}

/**
 * outputGroupDetails[].outputDetails[].durationInMs の最大値を秒に丸めて返す。
 * どの output も尺情報を持たない場合は undefined。
 */
export function extractDurationSeconds(
  detail: MediaConvertJobDetail,
): number | undefined {
  const groups = detail.outputGroupDetails;
  if (!Array.isArray(groups)) return undefined;

  let maxMs = 0;
  let found = false;
  for (const group of groups) {
    const outputs = group?.outputDetails;
    if (!Array.isArray(outputs)) continue;
    for (const output of outputs) {
      const ms = output?.durationInMs;
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) {
        found = true;
        if (ms > maxMs) maxMs = ms;
      }
    }
  }

  if (!found) return undefined;
  return Math.round(maxMs / 1000);
}
