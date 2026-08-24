/**
 * エンコード状態の引き寄せ (reconcile) 判定のテスト。
 *
 * 「完了通知が来ないまま PROCESSING で固まる」というデッドロックを
 * 解消するための中核ロジックなので、後退 (READY → FAILED) を
 * 起こさないことを含めて網羅的に確認する。
 */
import { decideReconcile, describeReconcile } from './video-sync';
import type { MediaConvertJobState } from './mediaconvert';

const HLS_KEY = 'hls/vid123/index.m3u8';

function job(partial: Partial<MediaConvertJobState>): MediaConvertJobState {
  return { jobId: 'job-1', status: 'PROGRESSING', ...partial };
}

describe('decideReconcile — ジョブ状態が取得できる場合', () => {
  it('COMPLETE なら READY にし、HLS キーを確定する', () => {
    const d = decideReconcile({
      currentStatus: 'PROCESSING',
      jobState: job({ status: 'COMPLETE' }),
      hlsKey: HLS_KEY,
    });
    expect(d).toEqual({
      action: 'ready',
      s3HlsKey: HLS_KEY,
      reason: 'job_complete',
    });
  });

  it('COMPLETE で尺が取れれば durationSeconds を含める', () => {
    const d = decideReconcile({
      currentStatus: 'PROCESSING',
      jobState: job({ status: 'COMPLETE', durationSeconds: 123 }),
      hlsKey: HLS_KEY,
    });
    expect(d).toMatchObject({ action: 'ready', durationSeconds: 123 });
  });

  it('ERROR なら FAILED にし、エラーメッセージを引き継ぐ', () => {
    const d = decideReconcile({
      currentStatus: 'PROCESSING',
      jobState: job({ status: 'ERROR', errorMessage: 'code=1404 bad input' }),
      hlsKey: HLS_KEY,
    });
    expect(d).toEqual({
      action: 'failed',
      errorMessage: 'code=1404 bad input',
      reason: 'job_error',
    });
  });

  it('CANCELED も FAILED として扱う', () => {
    const d = decideReconcile({
      currentStatus: 'PROCESSING',
      jobState: job({ status: 'CANCELED' }),
      hlsKey: HLS_KEY,
    });
    expect(d).toMatchObject({ action: 'failed', reason: 'job_canceled' });
  });

  it('PROGRESSING なら進捗率を返して待たせる', () => {
    const d = decideReconcile({
      currentStatus: 'PROCESSING',
      jobState: job({ status: 'PROGRESSING', progressPercent: 42 }),
      hlsKey: HLS_KEY,
    });
    expect(d).toEqual({
      action: 'processing',
      progressPercent: 42,
      reason: 'job_in_progress',
    });
  });

  it('SUBMITTED も進行中として扱う', () => {
    const d = decideReconcile({
      currentStatus: 'PROCESSING',
      jobState: job({ status: 'SUBMITTED' }),
      hlsKey: HLS_KEY,
    });
    expect(d).toMatchObject({ action: 'processing' });
  });
});

describe('decideReconcile — 後退させないこと (重要)', () => {
  it('既に READY のものは COMPLETE でも何もしない (publishedAt を壊さない)', () => {
    const d = decideReconcile({
      currentStatus: 'READY',
      jobState: job({ status: 'COMPLETE' }),
      hlsKey: HLS_KEY,
    });
    expect(d).toEqual({ action: 'none', reason: 'already_ready' });
  });

  it('既に READY のものを、古いジョブの ERROR で FAILED に巻き戻さない', () => {
    const d = decideReconcile({
      currentStatus: 'READY',
      jobState: job({ status: 'ERROR', errorMessage: 'stale' }),
      hlsKey: HLS_KEY,
    });
    expect(d).toEqual({
      action: 'none',
      reason: 'already_ready_ignore_job_error',
    });
  });

  it('既に FAILED のものを重複して FAILED にしない', () => {
    const d = decideReconcile({
      currentStatus: 'FAILED',
      jobState: job({ status: 'ERROR' }),
      hlsKey: HLS_KEY,
    });
    expect(d).toEqual({ action: 'none', reason: 'already_failed' });
  });
});

describe('decideReconcile — ジョブ情報が取れない場合は S3 実体で判断', () => {
  it('ジョブが引けず S3 に index.m3u8 があれば READY にする', () => {
    const d = decideReconcile({
      currentStatus: 'PROCESSING',
      jobState: null,
      hlsExists: true,
      hlsKey: HLS_KEY,
    });
    expect(d).toEqual({
      action: 'ready',
      s3HlsKey: HLS_KEY,
      reason: 'hls_found_in_s3',
    });
  });

  it('ジョブが引けず S3 にも無ければ何もしない', () => {
    const d = decideReconcile({
      currentStatus: 'PROCESSING',
      jobState: null,
      hlsExists: false,
      hlsKey: HLS_KEY,
    });
    expect(d).toEqual({ action: 'none', reason: 'hls_not_found' });
  });

  it('S3 未確認 (undefined) なら判定不能として何もしない', () => {
    const d = decideReconcile({
      currentStatus: 'PROCESSING',
      jobState: null,
      hlsKey: HLS_KEY,
    });
    expect(d).toEqual({ action: 'none', reason: 'indeterminate' });
  });

  it('status=UNKNOWN のときも S3 実体にフォールバックする', () => {
    const d = decideReconcile({
      currentStatus: 'PROCESSING',
      jobState: job({ status: 'UNKNOWN' }),
      hlsExists: true,
      hlsKey: HLS_KEY,
    });
    expect(d).toMatchObject({ action: 'ready', reason: 'hls_found_in_s3' });
  });

  it('S3 にあっても既に READY なら何もしない', () => {
    const d = decideReconcile({
      currentStatus: 'READY',
      jobState: null,
      hlsExists: true,
      hlsKey: HLS_KEY,
    });
    expect(d).toEqual({ action: 'none', reason: 'already_ready' });
  });
});

describe('describeReconcile — 管理画面向けの説明文', () => {
  it('ジョブ完了由来の READY を説明する', () => {
    expect(
      describeReconcile({
        action: 'ready',
        s3HlsKey: HLS_KEY,
        reason: 'job_complete',
      }),
    ).toContain('公開可能');
  });

  it('S3 発見由来の READY はその旨を明示する', () => {
    expect(
      describeReconcile({
        action: 'ready',
        s3HlsKey: HLS_KEY,
        reason: 'hls_found_in_s3',
      }),
    ).toContain('S3');
  });

  it('進捗率があれば文面に含める', () => {
    expect(
      describeReconcile({
        action: 'processing',
        progressPercent: 30,
        reason: 'job_in_progress',
      }),
    ).toContain('30%');
  });

  it('失敗理由を文面に含める', () => {
    expect(
      describeReconcile({
        action: 'failed',
        errorMessage: 'code=1404',
        reason: 'job_error',
      }),
    ).toContain('code=1404');
  });

  it('HLS 未発見はエンコード中の可能性を案内する', () => {
    expect(
      describeReconcile({ action: 'none', reason: 'hls_not_found' }),
    ).toContain('見つかりません');
  });
});
