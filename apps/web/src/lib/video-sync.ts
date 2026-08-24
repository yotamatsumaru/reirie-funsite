/**
 * エンコード状態の「引き寄せ (reconcile)」ロジック。
 *
 * ## なぜ必要か
 * MediaConvert は完了を push 通知しない。通常は
 *   EventBridge → Lambda → POST /api/admin/videos/job-complete
 * で READY 化されるが、この通知経路が未整備 / 一時障害 / ルール未作成だと
 * Video は **PROCESSING のまま永久に止まる**。
 *
 * さらに従来は「手動で公開」ボタンが `s3HlsKey` の存在を条件にしていたため、
 *   完了通知が来ない → s3HlsKey が空 → 手動公開できない → 完了通知を待つしかない
 * というデッドロックになっていた。
 *
 * そこで本モジュールは「MediaConvert に直接聞く」/「S3 の出力実体を見る」
 * という 2 つの根拠から、あるべき状態を判定する。
 *
 * ## 判定の優先順位
 *   1. ジョブ状態が COMPLETE      → READY (s3HlsKey を確定)
 *   2. ジョブ状態が ERROR/CANCELED → FAILED
 *   3. ジョブ状態が進行中          → PROCESSING 継続 (進捗率を返す)
 *   4. ジョブ情報が取れない場合    → S3 に index.m3u8 があれば READY
 *      (ジョブの保持期限切れなど。MediaConvert は履歴を永久保持しない)
 *
 * 判定を純粋関数にしてあるので、AWS に接続せず単体テストできる。
 */
import type { MediaConvertJobState } from './mediaconvert';

/** 反映すべき次の状態 */
export type ReconcileDecision =
  | {
      action: 'ready';
      /** 確定した HLS マスタープレイリストの S3 キー */
      s3HlsKey: string;
      durationSeconds?: number;
      reason: string;
    }
  | { action: 'failed'; errorMessage?: string; reason: string }
  | {
      action: 'processing';
      progressPercent?: number;
      reason: string;
    }
  | { action: 'none'; reason: string };

export type ReconcileInput = {
  /** DB 上の現在ステータス */
  currentStatus: string;
  /** MediaConvert から取得したジョブ状態 (取得できなければ null) */
  jobState: MediaConvertJobState | null;
  /** 出力バケットに index.m3u8 が存在したか (未確認なら undefined) */
  hlsExists?: boolean;
  /** 確定させる HLS マスタープレイリストのキー */
  hlsKey: string;
};

/**
 * 現在の DB 状態と AWS 実状から、反映すべき状態を決める。
 *
 * 既に READY のものを FAILED に落とすような後退はさせない
 * (公開済み動画をポーリングで壊さないため)。
 */
export function decideReconcile(input: ReconcileInput): ReconcileDecision {
  const { currentStatus, jobState, hlsExists, hlsKey } = input;

  // --- ジョブ状態が取得できた場合はそれを最優先 ---
  if (jobState) {
    if (jobState.status === 'COMPLETE') {
      if (currentStatus === 'READY') {
        return { action: 'none', reason: 'already_ready' };
      }
      return {
        action: 'ready',
        s3HlsKey: hlsKey,
        ...(jobState.durationSeconds !== undefined
          ? { durationSeconds: jobState.durationSeconds }
          : {}),
        reason: 'job_complete',
      };
    }

    if (jobState.status === 'ERROR' || jobState.status === 'CANCELED') {
      // 公開済みの動画を、古いジョブのエラーで巻き戻さない
      if (currentStatus === 'READY') {
        return { action: 'none', reason: 'already_ready_ignore_job_error' };
      }
      if (currentStatus === 'FAILED') {
        return { action: 'none', reason: 'already_failed' };
      }
      return {
        action: 'failed',
        ...(jobState.errorMessage ? { errorMessage: jobState.errorMessage } : {}),
        reason: jobState.status === 'CANCELED' ? 'job_canceled' : 'job_error',
      };
    }

    if (jobState.status === 'SUBMITTED' || jobState.status === 'PROGRESSING') {
      return {
        action: 'processing',
        ...(jobState.progressPercent !== undefined
          ? { progressPercent: jobState.progressPercent }
          : {}),
        reason: 'job_in_progress',
      };
    }
    // UNKNOWN は S3 実体の確認にフォールバックする
  }

  // --- ジョブ情報が無い / UNKNOWN の場合は S3 の出力実体で判断 ---
  // MediaConvert はジョブ履歴を永久保持しないため、時間が経つと GetJob が
  // 引けなくなる。その場合でも出力が residing していれば公開できる。
  if (hlsExists === true) {
    if (currentStatus === 'READY') {
      return { action: 'none', reason: 'already_ready' };
    }
    return { action: 'ready', s3HlsKey: hlsKey, reason: 'hls_found_in_s3' };
  }

  if (hlsExists === false) {
    return { action: 'none', reason: 'hls_not_found' };
  }

  return { action: 'none', reason: 'indeterminate' };
}

/** 管理画面に出す日本語の説明文 (判定理由 → 人が読める文) */
export function describeReconcile(d: ReconcileDecision): string {
  switch (d.action) {
    case 'ready':
      return d.reason === 'hls_found_in_s3'
        ? 'S3 に HLS 出力が見つかったため、公開可能 (READY) にしました。'
        : 'エンコードが完了していたため、公開可能 (READY) にしました。';
    case 'failed':
      return `エンコードが失敗していました。${d.errorMessage ?? ''}`.trim();
    case 'processing':
      return d.progressPercent !== undefined
        ? `まだエンコード中です (進捗 ${d.progressPercent}%)。`
        : 'まだエンコード中です。';
    case 'none':
      if (d.reason === 'already_ready') return 'すでに公開可能な状態です。';
      if (d.reason === 'already_failed') return 'すでに失敗として記録されています。';
      if (d.reason === 'hls_not_found') {
        return 'HLS 出力がまだ見つかりません。エンコード中か、ジョブが失敗している可能性があります。';
      }
      return '状態を判定できませんでした。';
  }
}
