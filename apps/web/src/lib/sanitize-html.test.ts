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
});
