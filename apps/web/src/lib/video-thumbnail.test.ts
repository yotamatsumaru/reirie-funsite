import {
  classifyThumbnailValue,
  videoThumbnailMediaPath,
  validateThumbnailUrlInput,
  validateThumbnailFile,
  MAX_THUMBNAIL_BYTES,
  ALLOWED_THUMBNAIL_TYPES,
} from './video-thumbnail';

describe('classifyThumbnailValue', () => {
  it('エンコードが入れる S3 キーは s3key と判定する', () => {
    expect(classifyThumbnailValue('hls/abc/thumbnail.0000000.jpg')).toBe('s3key');
  });

  it('http(s) の絶対URLは absolute と判定する', () => {
    expect(classifyThumbnailValue('https://cdn.example.com/a.jpg')).toBe('absolute');
    expect(classifyThumbnailValue('http://example.com/a.png')).toBe('absolute');
    // スキーム判定は大文字小文字を問わない
    expect(classifyThumbnailValue('HTTPS://example.com/a.jpg')).toBe('absolute');
  });

  it('自サーバの内部パスは internal と判定する', () => {
    // ここが s3key に落ちると S3 キーとして署名され、サムネイルが全部壊れる
    expect(classifyThumbnailValue('/api/media/video-thumbnail/xyz?v=1')).toBe('internal');
  });

  it('前後の空白は判定に影響しない', () => {
    expect(classifyThumbnailValue('  https://example.com/a.jpg  ')).toBe('absolute');
    expect(classifyThumbnailValue('  /api/media/video-thumbnail/x  ')).toBe('internal');
  });

  it('プロトコル相対URLは absolute ではない（S3キー扱いになる）', () => {
    // `//host/path` を absolute として通すと、意図しない外部ホストを
    // そのまま <img src> に流すことになるので絞っている。
    expect(classifyThumbnailValue('//evil.example.com/a.jpg')).toBe('internal');
  });
});

describe('videoThumbnailMediaPath', () => {
  it('id とキャッシュバスターを含む内部パスを作る', () => {
    expect(videoThumbnailMediaPath('abc-123', 1700000000000)).toBe(
      '/api/media/video-thumbnail/abc-123?v=1700000000000',
    );
  });

  it('Date を渡すと epoch ミリ秒に変換する', () => {
    const d = new Date('2026-08-24T00:00:00Z');
    expect(videoThumbnailMediaPath('id1', d)).toBe(
      `/api/media/video-thumbnail/id1?v=${d.getTime()}`,
    );
  });

  it('id をURLエンコードする', () => {
    expect(videoThumbnailMediaPath('a/b', 1)).toBe('/api/media/video-thumbnail/a%2Fb?v=1');
  });

  it('生成したパスは internal と判定される（往復整合性）', () => {
    expect(classifyThumbnailValue(videoThumbnailMediaPath('id1', 1))).toBe('internal');
  });
});

describe('validateThumbnailUrlInput', () => {
  it('空文字は「未設定にする」意思表示として null を返す', () => {
    expect(validateThumbnailUrlInput('')).toEqual({ ok: true, value: null });
    expect(validateThumbnailUrlInput('   ')).toEqual({ ok: true, value: null });
  });

  it('https の URL を通し、前後の空白を落とす', () => {
    expect(validateThumbnailUrlInput('  https://example.com/a.jpg ')).toEqual({
      ok: true,
      value: 'https://example.com/a.jpg',
    });
  });

  it('http の URL も通す', () => {
    expect(validateThumbnailUrlInput('http://example.com/a.jpg').ok).toBe(true);
  });

  it('javascript: スキームを拒否する（XSS 防止）', () => {
    const r = validateThumbnailUrlInput('javascript:alert(1)');
    expect(r.ok).toBe(false);
  });

  it('data: スキームを拒否する', () => {
    expect(validateThumbnailUrlInput('data:image/png;base64,AAAA').ok).toBe(false);
  });

  it('スキームなしの相対パスを拒否する', () => {
    expect(validateThumbnailUrlInput('images/a.jpg').ok).toBe(false);
  });

  it('アップロードAPIが返した内部パスはそのまま通す', () => {
    // 編集フォームがアップロード直後の値を送り返しても弾かれないようにする。
    const v = '/api/media/video-thumbnail/abc?v=1';
    expect(validateThumbnailUrlInput(v)).toEqual({ ok: true, value: v });
  });

  it('内部パスに見せかけた別のパスは拒否する', () => {
    expect(validateThumbnailUrlInput('/etc/passwd').ok).toBe(false);
    expect(validateThumbnailUrlInput('/api/admin/users').ok).toBe(false);
  });

  it('極端に長いURLを拒否する', () => {
    const long = `https://example.com/${'a'.repeat(2100)}`;
    expect(validateThumbnailUrlInput(long).ok).toBe(false);
  });

  it('2000文字ちょうどは通す（境界）', () => {
    const base = 'https://example.com/';
    const url = base + 'a'.repeat(2000 - base.length);
    expect(url.length).toBe(2000);
    expect(validateThumbnailUrlInput(url).ok).toBe(true);
  });
});

describe('validateThumbnailFile', () => {
  it('JPEG / PNG / WebP を受け付け、拡張子を返す', () => {
    expect(validateThumbnailFile('image/jpeg', 1000)).toEqual({ ok: true, ext: 'jpg' });
    expect(validateThumbnailFile('image/png', 1000)).toEqual({ ok: true, ext: 'png' });
    expect(validateThumbnailFile('image/webp', 1000)).toEqual({ ok: true, ext: 'webp' });
  });

  it('GIF / AVIF は受け付けない', () => {
    // GIF はアニメーションが一覧で騒がしく、AVIF は古い iOS Safari で表示できない。
    expect(validateThumbnailFile('image/gif', 1000).ok).toBe(false);
    expect(validateThumbnailFile('image/avif', 1000).ok).toBe(false);
  });

  it('画像以外を拒否する', () => {
    expect(validateThumbnailFile('video/mp4', 1000).ok).toBe(false);
    expect(validateThumbnailFile('application/pdf', 1000).ok).toBe(false);
    expect(validateThumbnailFile('', 1000).ok).toBe(false);
  });

  it('空ファイルを拒否する', () => {
    expect(validateThumbnailFile('image/png', 0).ok).toBe(false);
  });

  it('上限ちょうどは通し、1バイト超えは拒否する（境界）', () => {
    expect(validateThumbnailFile('image/png', MAX_THUMBNAIL_BYTES).ok).toBe(true);
    expect(validateThumbnailFile('image/png', MAX_THUMBNAIL_BYTES + 1).ok).toBe(false);
  });

  it('拒否時は運営に伝わる日本語メッセージを返す', () => {
    const r = validateThumbnailFile('image/gif', 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('JPEG');
    const big = validateThumbnailFile('image/png', MAX_THUMBNAIL_BYTES + 1);
    if (!big.ok) expect(big.message).toContain('8MB');
  });

  it('許可テーブルの全エントリが通る（表と検証のズレ防止）', () => {
    for (const [type, ext] of Object.entries(ALLOWED_THUMBNAIL_TYPES)) {
      expect(validateThumbnailFile(type, 1)).toEqual({ ok: true, ext });
    }
  });
});
