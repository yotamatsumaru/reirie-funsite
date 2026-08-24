/**
 * MediaConvert GetJob レスポンスの解析 (parseJobState) のテスト。
 *
 * EventBridge 経路 (functions/video-job-complete/parse-event.ts) と
 * 同じ情報をポーリング経路でも取り出せることを担保する。
 */
import { parseJobState } from './mediaconvert';

describe('parseJobState', () => {
  it('COMPLETE を解析し、尺を秒に丸める', () => {
    const s = parseJobState(
      {
        Job: {
          Id: 'job-9',
          Status: 'COMPLETE',
          OutputGroupDetails: [
            { OutputDetails: [{ DurationInMs: 123_400 }, { DurationInMs: 123_600 }] },
          ],
        },
      },
      'fallback',
    );
    expect(s.jobId).toBe('job-9');
    expect(s.status).toBe('COMPLETE');
    // 最大値 123600ms → 124 秒
    expect(s.durationSeconds).toBe(124);
  });

  it('複数の出力グループから最大の尺を採用する', () => {
    const s = parseJobState(
      {
        Job: {
          Status: 'COMPLETE',
          OutputGroupDetails: [
            { OutputDetails: [{ DurationInMs: 5_000 }] },
            { OutputDetails: [{ DurationInMs: 30_000 }] },
          ],
        },
      },
      'j',
    );
    expect(s.durationSeconds).toBe(30);
  });

  it('進捗率を 0〜100 に丸める', () => {
    expect(
      parseJobState({ Job: { Status: 'PROGRESSING', JobPercentComplete: 47.6 } }, 'j')
        .progressPercent,
    ).toBe(48);
    expect(
      parseJobState({ Job: { Status: 'PROGRESSING', JobPercentComplete: 150 } }, 'j')
        .progressPercent,
    ).toBe(100);
  });

  it('ERROR は code= 付きのメッセージにまとめる', () => {
    const s = parseJobState(
      {
        Job: {
          Status: 'ERROR',
          ErrorCode: 1404,
          ErrorMessage: 'Unable to open input file',
        },
      },
      'j',
    );
    expect(s.status).toBe('ERROR');
    expect(s.errorMessage).toBe('code=1404 Unable to open input file');
  });

  it('未知のステータスは UNKNOWN に落とす (S3 フォールバックへ回す)', () => {
    expect(parseJobState({ Job: { Status: 'SOMETHING_NEW' } }, 'j').status).toBe(
      'UNKNOWN',
    );
  });

  it('Job が空でも落ちず、fallback の jobId を使う', () => {
    const s = parseJobState({}, 'fallback-id');
    expect(s.jobId).toBe('fallback-id');
    expect(s.status).toBe('UNKNOWN');
    expect(s.durationSeconds).toBeUndefined();
    expect(s.progressPercent).toBeUndefined();
  });

  it('尺情報が無ければ durationSeconds を付けない', () => {
    const s = parseJobState(
      { Job: { Status: 'COMPLETE', OutputGroupDetails: [{ OutputDetails: [{}] }] } },
      'j',
    );
    expect(s.durationSeconds).toBeUndefined();
  });

  it('不正な進捗率 (負値・NaN) は無視する', () => {
    expect(
      parseJobState({ Job: { Status: 'PROGRESSING', JobPercentComplete: -5 } }, 'j')
        .progressPercent,
    ).toBeUndefined();
    expect(
      parseJobState({ Job: { Status: 'PROGRESSING', JobPercentComplete: NaN } }, 'j')
        .progressPercent,
    ).toBeUndefined();
  });

  it('エラーメッセージは 1000 文字に切り詰める', () => {
    const s = parseJobState(
      { Job: { Status: 'ERROR', ErrorMessage: 'x'.repeat(2000) } },
      'j',
    );
    expect(s.errorMessage!.length).toBe(1000);
  });
});
