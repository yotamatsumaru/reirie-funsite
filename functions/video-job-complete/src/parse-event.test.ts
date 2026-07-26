import {
  buildErrorMessage,
  extractDurationSeconds,
  parseMediaConvertEvent,
  type MediaConvertEvent,
} from './parse-event';

const baseEvent = (
  detail: Record<string, unknown>,
): MediaConvertEvent => ({
  source: 'aws.mediaconvert',
  'detail-type': 'MediaConvert Job State Change',
  detail: detail as MediaConvertEvent['detail'],
});

describe('parseMediaConvertEvent', () => {
  it('COMPLETE を forward 対象として videoId と尺を抽出する', () => {
    const event = baseEvent({
      status: 'COMPLETE',
      jobId: '1700000000000-abcdef',
      userMetadata: { videoId: 'vid_123' },
      outputGroupDetails: [
        { outputDetails: [{ durationInMs: 61500 }, { durationInMs: 61000 }] },
      ],
    });

    const result = parseMediaConvertEvent(event);
    expect(result.kind).toBe('forward');
    if (result.kind !== 'forward') return;
    expect(result.payload).toEqual({
      jobId: '1700000000000-abcdef',
      status: 'COMPLETE',
      videoId: 'vid_123',
      durationSeconds: 62, // 61500ms → 62s (最大値を四捨五入)
    });
  });

  it('ERROR を forward 対象として errorMessage を組み立てる', () => {
    const event = baseEvent({
      status: 'ERROR',
      jobId: 'job-err-1',
      userMetadata: { videoId: 'vid_err' },
      errorCode: 1404,
      errorMessage: 'Unable to open input file',
    });

    const result = parseMediaConvertEvent(event);
    expect(result.kind).toBe('forward');
    if (result.kind !== 'forward') return;
    expect(result.payload).toEqual({
      jobId: 'job-err-1',
      status: 'ERROR',
      videoId: 'vid_err',
      errorMessage: 'code=1404 Unable to open input file',
    });
  });

  it('COMPLETE で userMetadata が無ければ videoId を省く', () => {
    const event = baseEvent({
      status: 'COMPLETE',
      jobId: 'job-no-meta',
    });
    const result = parseMediaConvertEvent(event);
    expect(result.kind).toBe('forward');
    if (result.kind !== 'forward') return;
    expect(result.payload.videoId).toBeUndefined();
    expect(result.payload.durationSeconds).toBeUndefined();
    expect(result.payload).toEqual({ jobId: 'job-no-meta', status: 'COMPLETE' });
  });

  it('PROGRESSING など中間状態は ignore する', () => {
    for (const status of ['SUBMITTED', 'PROGRESSING', 'STATUS_UPDATE', 'CANCELED']) {
      const result = parseMediaConvertEvent(
        baseEvent({ status, jobId: 'x' }),
      );
      expect(result.kind).toBe('ignore');
      if (result.kind !== 'ignore') return;
      expect(result.reason).toContain('non_terminal_status');
    }
  });

  it('jobId が無ければ ignore する', () => {
    const result = parseMediaConvertEvent(baseEvent({ status: 'COMPLETE' }));
    expect(result.kind).toBe('ignore');
    if (result.kind !== 'ignore') return;
    expect(result.reason).toBe('missing_jobId');
  });

  it('detail が無ければ ignore する', () => {
    const result = parseMediaConvertEvent({
      source: 'aws.mediaconvert',
      'detail-type': 'MediaConvert Job State Change',
    });
    expect(result.kind).toBe('ignore');
    if (result.kind !== 'ignore') return;
    expect(result.reason).toBe('missing_detail');
  });

  it('source が aws.mediaconvert 以外なら ignore する', () => {
    const result = parseMediaConvertEvent({
      source: 'aws.s3',
      detail: { status: 'COMPLETE', jobId: 'x' } as MediaConvertEvent['detail'],
    });
    expect(result.kind).toBe('ignore');
    if (result.kind !== 'ignore') return;
    expect(result.reason).toContain('unexpected_source');
  });

  it('source 未指定 (直接テスト invoke) は許容する', () => {
    const result = parseMediaConvertEvent({
      detail: { status: 'COMPLETE', jobId: 'direct' } as MediaConvertEvent['detail'],
    });
    expect(result.kind).toBe('forward');
  });
});

describe('extractDurationSeconds', () => {
  it('複数 output の最大 durationInMs を秒に丸める', () => {
    expect(
      extractDurationSeconds({
        outputGroupDetails: [
          { outputDetails: [{ durationInMs: 1000 }] },
          { outputDetails: [{ durationInMs: 2400 }, { durationInMs: 2600 }] },
        ],
      }),
    ).toBe(3); // 2600ms → 3s
  });

  it('尺情報が無ければ undefined', () => {
    expect(extractDurationSeconds({})).toBeUndefined();
    expect(
      extractDurationSeconds({ outputGroupDetails: [{ outputDetails: [] }] }),
    ).toBeUndefined();
  });

  it('不正な値 (NaN / 負値) は無視する', () => {
    expect(
      extractDurationSeconds({
        outputGroupDetails: [
          { outputDetails: [{ durationInMs: -5 }, { durationInMs: Number.NaN }] },
        ],
      }),
    ).toBeUndefined();
  });
});

describe('buildErrorMessage', () => {
  it('code と message を結合する', () => {
    expect(
      buildErrorMessage({ errorCode: 1404, errorMessage: 'boom' }),
    ).toBe('code=1404 boom');
  });

  it('どちらも無ければ undefined', () => {
    expect(buildErrorMessage({})).toBeUndefined();
  });

  it('1000 文字で切り詰める', () => {
    const long = 'a'.repeat(2000);
    const msg = buildErrorMessage({ errorMessage: long });
    expect(msg).toBeDefined();
    expect(msg!.length).toBe(1000);
  });
});
