import {
  EXTERNAL_LINK_REFERRER_POLICY,
  isInternalHref,
  linkify,
  linkifyEscapedHtml,
} from './linkify';

describe('linkify', () => {
  it('空文字は空配列', () => {
    expect(linkify('')).toEqual([]);
  });

  it('URL が無ければテキスト 1 件だけ返す', () => {
    expect(linkify('お知らせ本文です')).toEqual([
      { type: 'text', value: 'お知らせ本文です' },
    ]);
  });

  it('https URL をリンク化する', () => {
    expect(linkify('詳細は https://example.com/a です')).toEqual([
      { type: 'text', value: '詳細は ' },
      {
        type: 'link',
        value: 'https://example.com/a',
        href: 'https://example.com/a',
        isEmail: false,
      },
      { type: 'text', value: ' です' },
    ]);
  });

  it('http URL もリンク化する', () => {
    const t = linkify('http://example.com');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ type: 'link', href: 'http://example.com' });
  });

  it('www. 始まりは https:// を補完する', () => {
    const t = linkify('www.example.com を見て');
    expect(t[0]).toMatchObject({
      type: 'link',
      value: 'www.example.com',
      href: 'https://www.example.com',
    });
  });

  it('メールアドレスは mailto: にする', () => {
    const t = linkify('連絡は info@example.com まで');
    expect(t[1]).toMatchObject({
      type: 'link',
      value: 'info@example.com',
      href: 'mailto:info@example.com',
      isEmail: true,
    });
  });

  it('複数の URL を全てリンク化する', () => {
    const t = linkify('A https://a.example.com B https://b.example.com C');
    const links = t.filter((x) => x.type === 'link');
    expect(links).toHaveLength(2);
    expect(t.map((x) => x.type)).toEqual(['text', 'link', 'text', 'link', 'text']);
  });

  it('クエリ・フラグメント付き URL を壊さない', () => {
    const url = 'https://example.com/p?a=1&b=2#sec';
    const t = linkify(`見て ${url}`);
    expect(t[1]).toMatchObject({ type: 'link', value: url, href: url });
  });

  describe('末尾の句読点を URL に含めない', () => {
    it.each([
      ['https://example.com/a。', 'https://example.com/a', '。'],
      ['https://example.com/a、', 'https://example.com/a', '、'],
      ['https://example.com/a.', 'https://example.com/a', '.'],
      ['https://example.com/a!', 'https://example.com/a', '!'],
      ['https://example.com/a?', 'https://example.com/a', '?'],
      ['https://example.com/a」', 'https://example.com/a', '」'],
    ])('%s → %s + %s', (input, expectedUrl, expectedTail) => {
      const t = linkify(input);
      expect(t[0]).toMatchObject({ type: 'link', value: expectedUrl });
      expect(t[1]).toEqual({ type: 'text', value: expectedTail });
    });

    it('括弧で囲まれた URL は括弧を含めない', () => {
      const t = linkify('(https://example.com/a)');
      expect(t[0]).toEqual({ type: 'text', value: '(' });
      expect(t[1]).toMatchObject({ type: 'link', value: 'https://example.com/a' });
      expect(t[2]).toEqual({ type: 'text', value: ')' });
    });

    it('URL 内で対応の取れた括弧は残す', () => {
      const url = 'https://ja.wikipedia.org/wiki/Foo_(bar)';
      const t = linkify(url);
      expect(t[0]).toMatchObject({ type: 'link', value: url });
    });
  });

  /**
   * 回帰テスト。
   * URL の文字クラスを否定クラス ([^\s<>"'`]+) にしていたため、
   * 空白で区切られていない日本語が URL に飲み込まれてリンク先が壊れていた。
   */
  describe('回帰: 日本語が URL に飲み込まれない', () => {
    it.each([
      ['詳細は https://example.com/aをご覧ください', 'https://example.com/a'],
      ['応募は https://example.com/formから！', 'https://example.com/form'],
      ['https://example.com/p?id=7&ref=mailから応募', 'https://example.com/p?id=7&ref=mail'],
      ['www.example.co.jp/shopで購入', 'www.example.co.jp/shop'],
      ['https://example.com/a。次は…', 'https://example.com/a'],
    ])('%s → %s', (input, expectedUrl) => {
      const t = linkify(input);
      const link = t.find((x) => x.type === 'link');
      expect(link).toMatchObject({ type: 'link', value: expectedUrl });
      // 情報が失われていないこと
      expect(t.map((x) => x.value).join('')).toBe(input);
    });

    it('href に日本語が混入しない', () => {
      const t = linkify('応募フォーム(https://example.com/form?id=7)から！');
      const link = t.find((x) => x.type === 'link');
      expect(link).toBeDefined();
      if (link?.type === 'link') {
        // 全角文字が href に入っていないことを保証する
        expect(link.href).not.toMatch(/[^\x20-\x7e]/);
        expect(link.href).toBe('https://example.com/form?id=7');
      }
    });
  });

  describe('セキュリティ: 危険なスキームはリンクにしない', () => {
    it.each([
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ])('%s はリンク化されない', (input) => {
      const t = linkify(`見て ${input}`);
      expect(t.every((x) => x.type === 'text')).toBe(true);
    });

    it('javascript: を含む文字列でもテキストのまま残る（消えない）', () => {
      const t = linkify('javascript:alert(1)');
      const joined = t.map((x) => x.value).join('');
      expect(joined).toBe('javascript:alert(1)');
    });
  });

  it('分解したトークンを連結すると元の文字列に戻る（情報が失われない）', () => {
    const inputs = [
      'テキストのみ',
      '詳細は https://example.com/a です。',
      'A https://a.example.com B info@example.com C',
      '(https://example.com/a) と www.example.com。',
      'javascript:alert(1) は無効',
      'https://example.com/p?a=1&b=2#sec',
    ];
    for (const input of inputs) {
      expect(linkify(input).map((t) => t.value).join('')).toBe(input);
    }
  });

  it('改行を保持する', () => {
    const t = linkify('1行目\nhttps://example.com\n3行目');
    expect(t.map((x) => x.value).join('')).toBe('1行目\nhttps://example.com\n3行目');
  });
});

describe('isInternalHref', () => {
  it('origin 未指定なら常に false', () => {
    expect(isInternalHref('https://example.com/a')).toBe(false);
  });

  it('同一 origin なら true', () => {
    expect(isInternalHref('https://reirie.com/notices/1', 'https://reirie.com')).toBe(
      true,
    );
  });

  it('別ドメインは false', () => {
    expect(isInternalHref('https://evil.com/a', 'https://reirie.com')).toBe(false);
  });

  it('スキームが違えば false', () => {
    expect(isInternalHref('http://reirie.com/a', 'https://reirie.com')).toBe(false);
  });

  it('不正な URL は false（例外を投げない）', () => {
    expect(isInternalHref('not a url', 'https://reirie.com')).toBe(false);
  });

  it('mailto は false', () => {
    expect(isInternalHref('mailto:a@example.com', 'https://reirie.com')).toBe(false);
  });
});

describe('linkifyEscapedHtml', () => {
  it('URL をアンカータグに変換する', () => {
    const html = linkifyEscapedHtml('詳細は https://example.com/a です');
    expect(html).toContain('<a href="https://example.com/a"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('>https://example.com/a</a>');
  });

  it('URL が無ければそのまま返す', () => {
    expect(linkifyEscapedHtml('ただの本文')).toBe('ただの本文');
  });

  /**
   * 回帰テスト: LivePocket の「アクセス元制限」対応。
   *
   * noreferrer を付けると Referer が送られず、
   * 「https://reirie.com/ からのアクセスのみ許可」という設定に弾かれて
   * 会員が先行抽選ページを開けなくなる。
   * 良かれと思って noreferrer を足し戻されるのを防ぐためのテスト。
   */
  describe('回帰: アクセス元制限 (Referer) を壊さない', () => {
    it('noreferrer を付けない', () => {
      const html = linkifyEscapedHtml('https://livepocket.jp/e/c1a-7zi3rr');
      expect(html).not.toContain('noreferrer');
    });

    it('タブナビゲーション対策の noopener は維持する', () => {
      const html = linkifyEscapedHtml('https://livepocket.jp/e/c1a-7zi3rr');
      expect(html).toContain('rel="noopener"');
    });

    it('referrerpolicy を明示する (オリジンのみ送信)', () => {
      const html = linkifyEscapedHtml('https://livepocket.jp/e/c1a-7zi3rr');
      expect(html).toContain(
        `referrerpolicy="${EXTERNAL_LINK_REFERRER_POLICY}"`,
      );
    });

    it('referrerpolicy はパスを送らない値である', () => {
      // no-referrer / same-origin だと Referer 自体が消える or 送られないため、
      // アクセス元制限のドメイン判定を通せなくなる。
      expect(EXTERNAL_LINK_REFERRER_POLICY).toBe(
        'strict-origin-when-cross-origin',
      );
      expect(EXTERNAL_LINK_REFERRER_POLICY).not.toBe('no-referrer');
      expect(EXTERNAL_LINK_REFERRER_POLICY).not.toBe('same-origin');
    });

    it('mailto には target / referrerpolicy を付けない', () => {
      const html = linkifyEscapedHtml('info@example.com');
      expect(html).toContain('href="mailto:info@example.com"');
      expect(html).not.toContain('target="_blank"');
      expect(html).not.toContain('referrerpolicy');
    });
  });

  it('javascript: はアンカーにしない', () => {
    const html = linkifyEscapedHtml('javascript:alert(1)');
    expect(html).not.toContain('<a ');
  });

  it('末尾の句読点はアンカー外に出す', () => {
    const html = linkifyEscapedHtml('https://example.com/a。');
    expect(html).toContain('>https://example.com/a</a>。');
  });

  it('既にエスケープされた & (&amp;) を含む URL を壊さない', () => {
    const html = linkifyEscapedHtml('https://example.com/p?a=1&amp;b=2');
    expect(html).toContain('href="https://example.com/p?a=1&amp;b=2"');
  });

  it('エスケープ済みの < > を再度アンカー化しない（HTML 混入なし）', () => {
    const html = linkifyEscapedHtml('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('mailto: には target="_blank" を付けない（メーラーを開くため）', () => {
    const html = linkifyEscapedHtml('連絡は info@example.com まで');
    expect(html).toContain('href="mailto:info@example.com"');
    expect(html).not.toContain('target="_blank"');
  });

  it('回帰: 日本語が URL に飲み込まれない', () => {
    const html = linkifyEscapedHtml('応募は https://example.com/formから！');
    expect(html).toContain('href="https://example.com/form"');
    expect(html).toContain('</a>から！');
  });
});
