import {
  ALLOWED_CONTENT_BODY_IMAGE_TYPES,
  MAX_CONTENT_BODY_IMAGE_BYTES,
  contentBodyImageMediaPath,
  formatBytes,
  validateContentBodyImage,
} from './content-body-image';

describe('validateContentBodyImage', () => {
  it('JPEG / PNG / WebP / GIF を受け付ける', () => {
    for (const [type, ext] of Object.entries(ALLOWED_CONTENT_BODY_IMAGE_TYPES)) {
      const r = validateContentBodyImage({ contentType: type, sizeBytes: 1024 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.ext).toBe(ext);
    }
  });

  it('contentType が無い場合は missing', () => {
    expect(validateContentBodyImage({ contentType: null, sizeBytes: 10 })).toEqual({
      ok: false,
      error: { kind: 'missing' },
    });
    expect(validateContentBodyImage({ contentType: '', sizeBytes: 10 })).toEqual({
      ok: false,
      error: { kind: 'missing' },
    });
  });

  it('charset 付きの content-type でも受け付ける', () => {
    // ブラウザや curl が "image/png; charset=binary" を送ることがある。
    const r = validateContentBodyImage({ contentType: 'image/png; charset=binary', sizeBytes: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contentType).toBe('image/png');
  });

  it('大文字の content-type でも受け付ける', () => {
    const r = validateContentBodyImage({ contentType: 'IMAGE/JPEG', sizeBytes: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ext).toBe('jpg');
  });

  it('SVG は拒否する（スクリプトを埋め込めるため）', () => {
    const r = validateContentBodyImage({ contentType: 'image/svg+xml', sizeBytes: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('type');
  });

  it('AVIF は拒否する（古い iOS Safari で表示できないため）', () => {
    const r = validateContentBodyImage({ contentType: 'image/avif', sizeBytes: 10 });
    expect(r.ok).toBe(false);
  });

  it('画像以外は拒否する', () => {
    const r = validateContentBodyImage({ contentType: 'application/pdf', sizeBytes: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('type');
  });

  it('上限ちょうどは許可する（境界）', () => {
    const r = validateContentBodyImage({
      contentType: 'image/png',
      sizeBytes: MAX_CONTENT_BODY_IMAGE_BYTES,
    });
    expect(r.ok).toBe(true);
  });

  it('上限を 1 バイト超えたら拒否する（境界）', () => {
    const r = validateContentBodyImage({
      contentType: 'image/png',
      sizeBytes: MAX_CONTENT_BODY_IMAGE_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('size');
  });

  it('サイズ超過のメッセージに上限と実サイズの両方を含む', () => {
    // 「大きすぎます」だけだと、どれくらい削ればよいか運営が判断できない。
    const r = validateContentBodyImage({
      contentType: 'image/png',
      sizeBytes: 10 * 1024 * 1024,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'size') {
      expect(r.error.message).toContain('8.0MB');
      expect(r.error.message).toContain('10.0MB');
    }
  });

  it('0 バイトのファイルは拒否する', () => {
    const r = validateContentBodyImage({ contentType: 'image/png', sizeBytes: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('size');
  });
});

describe('formatBytes', () => {
  it('単位を切り替える', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(1536)).toBe('1.5KB');
    expect(formatBytes(8 * 1024 * 1024)).toBe('8.0MB');
  });
});

describe('contentBodyImageMediaPath', () => {
  it('DB 保存時の配信パスを返す', () => {
    expect(contentBodyImageMediaPath('abc-123')).toBe('/api/media/content-body-image/abc-123');
  });
});
