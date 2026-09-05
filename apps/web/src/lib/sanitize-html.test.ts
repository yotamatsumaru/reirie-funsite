import { sanitizeContentBody } from './sanitize-html';

describe('sanitizeContentBody', () => {
  it('script タグを除去する', () => {
    const dirty = '<p>hello</p><script>alert(1)</script>';
    const clean = sanitizeContentBody(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).toContain('hello');
  });

  it('on* イベント属性を除去する', () => {
    const dirty = '<img src="x.png" onerror="alert(1)" />';
    const clean = sanitizeContentBody(dirty);
    expect(clean).not.toContain('onerror');
  });

  it('javascript: スキームのリンクを除去する', () => {
    const dirty = '<a href="javascript:alert(1)">click</a>';
    const clean = sanitizeContentBody(dirty);
    expect(clean).not.toContain('javascript:');
  });

  it('通常のリッチテキスト (見出し・リスト・リンク・画像) は保持する', () => {
    const html =
      '<h2>見出し</h2><p>本文<strong>強調</strong></p><ul><li>項目1</li></ul>' +
      '<a href="https://example.com">リンク</a><img src="https://example.com/a.png" alt="img" />';
    const clean = sanitizeContentBody(html);
    expect(clean).toContain('<h2>見出し</h2>');
    expect(clean).toContain('<strong>強調</strong>');
    expect(clean).toContain('<li>項目1</li>');
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain('src="https://example.com/a.png"');
  });

  it('外部リンクに rel="noopener noreferrer" を付与する', () => {
    const html = '<a href="https://example.com" target="_blank">リンク</a>';
    const clean = sanitizeContentBody(html);
    expect(clean).toContain('rel="noopener noreferrer"');
  });

  // ===== リッチテキストエディタ (TipTap) の出力互換性 =====
  it('下線 (u タグ) を保持する', () => {
    const clean = sanitizeContentBody('<p><u>下線</u></p>');
    expect(clean).toContain('<u>下線</u>');
  });

  it('揃え指定 (text-align の style) を保持する', () => {
    const clean = sanitizeContentBody('<p style="text-align: center">中央</p>');
    expect(clean).toContain('text-align');
  });

  it('エディタが付与する画像の class を保持する', () => {
    const clean = sanitizeContentBody('<img src="https://example.com/a.png" class="rounded-lg" alt="" />');
    expect(clean).toContain('class="rounded-lg"');
  });

  // ===== 本文動画 (短いクリップ) =====
  it('video タグと必要な属性を保持する', () => {
    const html =
      '<video src="/api/media/content-body-video/abc" controls preload="metadata" ' +
      'playsinline poster="/api/media/content-body-image/def" class="rounded-lg"></video>';
    const clean = sanitizeContentBody(html);
    expect(clean).toContain('<video');
    expect(clean).toContain('src="/api/media/content-body-video/abc"');
    expect(clean).toContain('controls');
    expect(clean).toContain('preload="metadata"');
    expect(clean).toContain('playsinline');
    expect(clean).toContain('poster="/api/media/content-body-image/def"');
    expect(clean).toContain('class="rounded-lg"');
  });

  it('video の autoplay を除去する (記事を開いた瞬間に音が鳴る事故を防ぐ)', () => {
    const clean = sanitizeContentBody('<video src="/a.mp4" controls autoplay></video>');
    expect(clean).not.toContain('autoplay');
    expect(clean).toContain('controls');
  });

  it('video の on* イベント属性を除去する', () => {
    const clean = sanitizeContentBody(
      '<video src="/a.mp4" onerror="alert(1)" onplay="alert(2)"></video>',
    );
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('onplay');
  });

  it('video の javascript: な src / poster を除去する', () => {
    const clean = sanitizeContentBody(
      '<video src="javascript:alert(1)" poster="javascript:alert(2)"></video>',
    );
    expect(clean).not.toContain('javascript:');
  });

  it('video の crossorigin を除去する', () => {
    const clean = sanitizeContentBody('<video src="/a.mp4" crossorigin="use-credentials"></video>');
    expect(clean).not.toContain('crossorigin');
  });

  it('source / track など許可していない子要素は除去する', () => {
    const clean = sanitizeContentBody(
      '<video controls><source src="/a.mp4" type="video/mp4"><track src="/a.vtt"></video>',
    );
    expect(clean).not.toContain('<source');
    expect(clean).not.toContain('<track');
  });

  it('iframe (外部埋め込み) は引き続き除去する', () => {
    const clean = sanitizeContentBody('<iframe src="https://evil.example.com"></iframe>');
    expect(clean).not.toContain('<iframe');
  });

  it('audio は許可していないので除去する', () => {
    const clean = sanitizeContentBody('<audio src="/a.mp3" controls></audio>');
    expect(clean).not.toContain('<audio');
  });
});
