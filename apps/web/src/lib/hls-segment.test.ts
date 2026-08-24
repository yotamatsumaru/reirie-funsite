import {
  segmentContentType,
  buildSegmentHeaders,
  hlsSegmentProxyUrl,
  playlistRelativeDir,
} from './hls-segment';

describe('segmentContentType', () => {
  it('MPEG-2 TS セグメントを video/mp2t にする', () => {
    // これが誤ると Safari / hls.js がセグメントを拒否する
    expect(segmentContentType('index_720p_00001.ts')).toBe('video/mp2t');
  });

  it('fMP4 / CMAF セグメントを判定する', () => {
    expect(segmentContentType('seg_00001.m4s')).toBe('video/iso.segment');
    expect(segmentContentType('init.mp4')).toBe('video/mp4');
    expect(segmentContentType('audio.m4a')).toBe('audio/mp4');
  });

  it('字幕と音声のみのレンディションを判定する', () => {
    expect(segmentContentType('subs.vtt')).toBe('text/vtt');
    expect(segmentContentType('audio.aac')).toBe('audio/aac');
  });

  it('AES-128 鍵をバイナリとして返す', () => {
    expect(segmentContentType('enc.key')).toBe('application/octet-stream');
  });

  it('プレイリストも一応判定できる', () => {
    expect(segmentContentType('index.m3u8')).toBe('application/vnd.apple.mpegurl');
  });

  it('大文字の拡張子でも判定する', () => {
    expect(segmentContentType('SEG.TS')).toBe('video/mp2t');
  });

  it('クエリ文字列を無視する', () => {
    expect(segmentContentType('seg.ts?X-Amz-Signature=abc')).toBe('video/mp2t');
  });

  it('サブディレクトリ付きでも判定する', () => {
    expect(segmentContentType('720p/seg_00001.ts')).toBe('video/mp2t');
  });

  it('未知の拡張子・拡張子なしは octet-stream にフォールバックする', () => {
    expect(segmentContentType('mystery.xyz')).toBe('application/octet-stream');
    expect(segmentContentType('noext')).toBe('application/octet-stream');
  });
});

describe('buildSegmentHeaders', () => {
  it('Content-Type は上流ではなく拡張子から決める', () => {
    // MediaConvert の出力は binary/octet-stream になることがあり、
    // それを転送するとプレイヤーが再生を拒否しうる
    const upstream = new Headers({ 'content-type': 'binary/octet-stream' });
    const h = buildSegmentHeaders(upstream, 'seg.ts');
    expect(h['Content-Type']).toBe('video/mp2t');
  });

  it('Accept-Ranges: bytes を必ず立てる', () => {
    const h = buildSegmentHeaders(new Headers(), 'seg.ts');
    expect(h['Accept-Ranges']).toBe('bytes');
  });

  it('Content-Length / Content-Range / ETag を透過する', () => {
    // これらを落とすとシーク (Range リクエスト) が壊れる
    const upstream = new Headers({
      'content-length': '1024',
      'content-range': 'bytes 0-1023/4096',
      etag: '"abc123"',
      'last-modified': 'Mon, 24 Aug 2026 00:00:00 GMT',
    });
    const h = buildSegmentHeaders(upstream, 'seg.ts');
    expect(h['Content-Length']).toBe('1024');
    expect(h['Content-Range']).toBe('bytes 0-1023/4096');
    expect(h['ETag']).toBe('"abc123"');
    expect(h['Last-Modified']).toBe('Mon, 24 Aug 2026 00:00:00 GMT');
  });

  it('上流に無いヘッダは付けない', () => {
    const h = buildSegmentHeaders(new Headers({ 'content-length': '10' }), 'seg.ts');
    expect(h['Content-Range']).toBeUndefined();
    expect(h['ETag']).toBeUndefined();
  });

  it('S3 の署名情報を漏らすヘッダは転送しない', () => {
    const upstream = new Headers({
      'x-amz-request-id': 'REQ123',
      'x-amz-id-2': 'ID2',
      server: 'AmazonS3',
    });
    const h = buildSegmentHeaders(upstream, 'seg.ts');
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('x-amz-request-id');
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('server');
  });

  it('キャッシュは private (共有キャッシュ禁止) で、ブラウザ内は許可する', () => {
    // 有料コンテンツを CDN/プロキシに共有させない。
    // 一方 no-store にすると HLS がシーク毎に S3 まで取りに行き体感が悪化する。
    const h = buildSegmentHeaders(new Headers(), 'seg.ts');
    expect(h['Cache-Control']).toBe('private, max-age=300');
    expect(h['Cache-Control']).not.toContain('public');
  });

  it('max-age を指定できる', () => {
    const h = buildSegmentHeaders(new Headers(), 'seg.ts', 60);
    expect(h['Cache-Control']).toBe('private, max-age=60');
  });
});

describe('hlsSegmentProxyUrl', () => {
  it('自サーバの絶対パスを返す (S3 ドメインを含まない = CORS 不要)', () => {
    const url = hlsSegmentProxyUrl('vid123', 'index_720p_00001.ts');
    expect(url).toBe('/api/videos/vid123/hls/index_720p_00001.ts');
    // ここが S3 の絶対URLになると CORS 設定が必要になってしまう
    expect(url).not.toMatch(/^https?:\/\//);
    expect(url).not.toContain('amazonaws.com');
  });

  it('videoId をエスケープする', () => {
    expect(hlsSegmentProxyUrl('a/b', 'seg.ts')).toBe('/api/videos/a%2Fb/hls/seg.ts');
  });

  it('サブディレクトリの区切り (/) は保ったままエスケープする', () => {
    expect(hlsSegmentProxyUrl('vid1', '720p/seg 1.ts')).toBe(
      '/api/videos/vid1/hls/720p/seg%201.ts',
    );
  });

  it('空のパスセグメントを落とす', () => {
    expect(hlsSegmentProxyUrl('vid1', '720p//seg.ts')).toBe('/api/videos/vid1/hls/720p/seg.ts');
  });
});

describe('playlistRelativeDir', () => {
  it('同一階層のプレイリストは空文字', () => {
    expect(playlistRelativeDir('index.m3u8')).toBe('');
  });

  it('サブディレクトリにあるプレイリストはその prefix を返す', () => {
    // `720p/index.m3u8` 内の `seg.ts` の実体は `720p/seg.ts`
    expect(playlistRelativeDir('720p/index.m3u8')).toBe('720p/');
  });

  it('多階層でも動く', () => {
    expect(playlistRelativeDir('a/b/index.m3u8')).toBe('a/b/');
  });
});
