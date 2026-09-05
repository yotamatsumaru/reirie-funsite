import {
  ALLOWED_CONTENT_BODY_VIDEO_TYPES,
  CONTENT_BODY_VIDEO_SOFT_MAX_SECONDS,
  MAX_CONTENT_BODY_VIDEO_BYTES,
  contentBodyVideoCompatibilityWarning,
  contentBodyVideoDurationWarning,
  contentBodyVideoMediaPath,
  formatBytes,
  formatSeconds,
  validateContentBodyVideo,
} from './content-body-video';

describe('validateContentBodyVideo', () => {
  it('MP4 を受け付ける', () => {
    const r = validateContentBodyVideo({ contentType: 'video/mp4', sizeBytes: 1024 });
    expect(r).toEqual({ ok: true, contentType: 'video/mp4', ext: 'mp4' });
  });

  it('WebM / MOV も受け付ける', () => {
    expect(validateContentBodyVideo({ contentType: 'video/webm', sizeBytes: 1 })).toEqual({
      ok: true,
      contentType: 'video/webm',
      ext: 'webm',
    });
    expect(validateContentBodyVideo({ contentType: 'video/quicktime', sizeBytes: 1 })).toEqual({
      ok: true,
      contentType: 'video/quicktime',
      ext: 'mov',
    });
  });

  it('codecs パラメータ付きの Content-Type でも受け付ける', () => {
    const r = validateContentBodyVideo({
      contentType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
      sizeBytes: 1024,
    });
    expect(r).toEqual({ ok: true, contentType: 'video/mp4', ext: 'mp4' });
  });

  it('大文字の Content-Type を正規化する', () => {
    const r = validateContentBodyVideo({ contentType: 'VIDEO/MP4', sizeBytes: 1024 });
    expect(r).toEqual({ ok: true, contentType: 'video/mp4', ext: 'mp4' });
  });

  it('Content-Type が無い場合は missing', () => {
    for (const v of [null, undefined, '']) {
      const r = validateContentBodyVideo({ contentType: v, sizeBytes: 1024 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('missing');
    }
  });

  it('画像や AVI など対応外の形式は type エラー', () => {
    for (const t of ['image/png', 'video/x-msvideo', 'video/x-matroska', 'application/pdf']) {
      const r = validateContentBodyVideo({ contentType: t, sizeBytes: 1024 });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('type');
        // 次に何をすればよいかが分かる文言になっていること
        expect(r.error.kind === 'type' && r.error.message).toContain('MP4');
      }
    }
  });

  it('上限ちょうどは通り、1バイト超えると size エラー', () => {
    expect(
      validateContentBodyVideo({
        contentType: 'video/mp4',
        sizeBytes: MAX_CONTENT_BODY_VIDEO_BYTES,
      }).ok,
    ).toBe(true);

    const over = validateContentBodyVideo({
      contentType: 'video/mp4',
      sizeBytes: MAX_CONTENT_BODY_VIDEO_BYTES + 1,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.error.kind).toBe('size');
      // 長尺は VOD へ誘導していること
      expect(over.error.kind === 'size' && over.error.message).toContain('動画管理');
    }
  });

  it('0 バイト / 負のサイズは size エラー', () => {
    for (const s of [0, -1]) {
      const r = validateContentBodyVideo({ contentType: 'video/mp4', sizeBytes: s });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('size');
    }
  });

  it('上限は nginx の client_max_body_size (50MB) より小さい', () => {
    // multipart のオーバーヘッドを載せても nginx に 413 で切られないこと
    expect(MAX_CONTENT_BODY_VIDEO_BYTES).toBeLessThan(50 * 1024 * 1024);
  });
});

describe('contentBodyVideoCompatibilityWarning', () => {
  it('MP4 は警告なし', () => {
    expect(contentBodyVideoCompatibilityWarning('video/mp4')).toBeNull();
  });

  it('WebM は iPhone の注意を出す', () => {
    const w = contentBodyVideoCompatibilityWarning('video/webm');
    expect(w).toContain('iPhone');
  });

  it('MOV も注意を出す', () => {
    expect(contentBodyVideoCompatibilityWarning('video/quicktime')).not.toBeNull();
  });

  it('codecs 付き・大文字でも判定できる', () => {
    expect(contentBodyVideoCompatibilityWarning('VIDEO/WEBM; codecs="vp9"')).not.toBeNull();
  });

  it('null は警告なし', () => {
    expect(contentBodyVideoCompatibilityWarning(null)).toBeNull();
    expect(contentBodyVideoCompatibilityWarning(undefined)).toBeNull();
  });
});

describe('contentBodyVideoDurationWarning', () => {
  it('目安以内なら警告なし', () => {
    expect(contentBodyVideoDurationWarning(10)).toBeNull();
    expect(contentBodyVideoDurationWarning(CONTENT_BODY_VIDEO_SOFT_MAX_SECONDS)).toBeNull();
  });

  it('目安を超えたら警告を出す', () => {
    const w = contentBodyVideoDurationWarning(CONTENT_BODY_VIDEO_SOFT_MAX_SECONDS + 1);
    expect(w).not.toBeNull();
    expect(w).toContain('動画管理');
  });

  it('壊れたメタデータ (Infinity / NaN / 0 / 負) では警告を出さない', () => {
    // ブラウザが duration を測れないケースで誤警告しないこと
    for (const d of [Infinity, NaN, 0, -5]) {
      expect(contentBodyVideoDurationWarning(d)).toBeNull();
    }
  });
});

describe('formatBytes', () => {
  it('単位を切り替える', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(2048)).toBe('2.0KB');
    expect(formatBytes(32 * 1024 * 1024)).toBe('32.0MB');
  });
});

describe('formatSeconds', () => {
  it('分と秒を組み立てる', () => {
    expect(formatSeconds(45)).toBe('45秒');
    expect(formatSeconds(60)).toBe('1分');
    expect(formatSeconds(65)).toBe('1分5秒');
    expect(formatSeconds(125)).toBe('2分5秒');
  });

  it('負の値は 0 秒として扱う', () => {
    expect(formatSeconds(-3)).toBe('0秒');
  });
});

describe('contentBodyVideoMediaPath', () => {
  it('DB 保存時の配信パスを返す', () => {
    expect(contentBodyVideoMediaPath('abc')).toBe('/api/media/content-body-video/abc');
  });
});

describe('ALLOWED_CONTENT_BODY_VIDEO_TYPES', () => {
  it('Web で直接再生できない形式を含まない', () => {
    const keys = Object.keys(ALLOWED_CONTENT_BODY_VIDEO_TYPES);
    expect(keys).not.toContain('video/x-msvideo');
    expect(keys).not.toContain('video/x-matroska');
  });

  it('すべて video/ で始まる', () => {
    for (const k of Object.keys(ALLOWED_CONTENT_BODY_VIDEO_TYPES)) {
      expect(k.startsWith('video/')).toBe(true);
    }
  });
});
