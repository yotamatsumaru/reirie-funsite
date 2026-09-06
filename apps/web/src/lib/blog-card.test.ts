import {
  BLOG_COVER_CARD_EXCERPT_LINES,
  BLOG_TEXT_CARD_EXCERPT_LINES,
  excerptLineClamp,
  hasUsableCoverImage,
  plainTextFromHtml,
  resolveBlogCardVariant,
  resolveCardDescription,
} from './blog-card';

describe('hasUsableCoverImage', () => {
  it('URL があれば true', () => {
    expect(hasUsableCoverImage('/api/media/content-body-image/abc')).toBe(true);
    expect(hasUsableCoverImage('https://example.com/a.png')).toBe(true);
  });

  it('null / undefined は false', () => {
    expect(hasUsableCoverImage(null)).toBe(false);
    expect(hasUsableCoverImage(undefined)).toBe(false);
  });

  it('空文字は false (回帰: <img src=""> で壊れた画像アイコンが出ていた)', () => {
    expect(hasUsableCoverImage('')).toBe(false);
  });

  it('空白のみは false (フォームでスペースだけ入った場合)', () => {
    expect(hasUsableCoverImage('   ')).toBe(false);
    expect(hasUsableCoverImage('\n\t ')).toBe(false);
  });

  it('文字列以外は false (DB の型が変わっても落ちない)', () => {
    expect(hasUsableCoverImage(123 as unknown as string)).toBe(false);
    expect(hasUsableCoverImage({} as unknown as string)).toBe(false);
  });
});

describe('resolveBlogCardVariant', () => {
  it('サムネイルがあれば cover', () => {
    expect(resolveBlogCardVariant('/a.png')).toBe('cover');
  });

  it('サムネイルが無ければ text', () => {
    expect(resolveBlogCardVariant(null)).toBe('text');
    expect(resolveBlogCardVariant('')).toBe('text');
    expect(resolveBlogCardVariant('  ')).toBe('text');
  });
});

describe('excerptLineClamp', () => {
  it('テキストカードは画像ありより多くの行を見せる', () => {
    // 画像枠が無い分の高さを抜粋に回し、グリッドの高さを揃える
    expect(excerptLineClamp('text')).toBeGreaterThan(excerptLineClamp('cover'));
  });

  it('定数と一致する', () => {
    expect(excerptLineClamp('text')).toBe(BLOG_TEXT_CARD_EXCERPT_LINES);
    expect(excerptLineClamp('cover')).toBe(BLOG_COVER_CARD_EXCERPT_LINES);
  });
});

describe('plainTextFromHtml', () => {
  it('タグを除去してテキストだけ返す', () => {
    expect(plainTextFromHtml('<p>こんにちは</p>')).toBe('こんにちは');
  });

  it('ブロックタグの境界に空白を入れる (単語が繋がるのを防ぐ)', () => {
    // 空白を入れないと「見出し本文」になってしまう
    expect(plainTextFromHtml('<h2>見出し</h2><p>本文</p>')).toBe('見出し 本文');
  });

  it('<br> を空白にする', () => {
    expect(plainTextFromHtml('一行目<br>二行目')).toBe('一行目 二行目');
    expect(plainTextFromHtml('一行目<br />二行目')).toBe('一行目 二行目');
  });

  it('リストの項目が繋がらない', () => {
    expect(plainTextFromHtml('<ul><li>A</li><li>B</li></ul>')).toBe('A B');
  });

  it('連続する空白・改行を 1 つに畳む', () => {
    expect(plainTextFromHtml('<p>あ</p>\n\n   <p>い</p>')).toBe('あ い');
  });

  it('実体参照を戻す', () => {
    expect(plainTextFromHtml('<p>A&amp;B</p>')).toBe('A&B');
    expect(plainTextFromHtml('<p>a&nbsp;b</p>')).toBe('a b');
    expect(plainTextFromHtml('<p>&lt;tag&gt;</p>')).toBe('<tag>');
    expect(plainTextFromHtml('<p>&quot;q&quot;</p>')).toBe('"q"');
    expect(plainTextFromHtml('<p>it&#39;s</p>')).toBe("it's");
  });

  it('画像や動画だけの本文は null (テキストが無い)', () => {
    expect(plainTextFromHtml('<p><img src="/a.png" /></p>')).toBeNull();
    expect(plainTextFromHtml('<video src="/a.mp4"></video>')).toBeNull();
  });

  it('空・null は null', () => {
    expect(plainTextFromHtml('')).toBeNull();
    expect(plainTextFromHtml(null)).toBeNull();
    expect(plainTextFromHtml(undefined)).toBeNull();
    expect(plainTextFromHtml('   ')).toBeNull();
    expect(plainTextFromHtml('<p></p>')).toBeNull();
  });

  it('長い本文は maxLength で切って三点リーダを付ける', () => {
    const body = `<p>${'あ'.repeat(300)}</p>`;
    const r = plainTextFromHtml(body, 120);
    expect(r).not.toBeNull();
    expect(r!.endsWith('…')).toBe(true);
    // 120 文字 + 三点リーダ
    expect(r!.length).toBe(121);
  });

  it('maxLength 以内なら三点リーダを付けない', () => {
    expect(plainTextFromHtml('<p>短い</p>', 120)).toBe('短い');
  });

  it('切り取った末尾の空白は落とす (「あ …」にならない)', () => {
    const r = plainTextFromHtml(`<p>${'あ'.repeat(119)} いいい</p>`, 120);
    expect(r).not.toContain(' …');
  });

  it('タグの属性に > が無い通常の HTML を壊さない', () => {
    expect(plainTextFromHtml('<a href="https://example.com/?a=1">リンク</a>')).toBe('リンク');
  });

  it('文字列以外は null', () => {
    expect(plainTextFromHtml(42 as unknown as string)).toBeNull();
  });
});

describe('resolveCardDescription', () => {
  it('抜粋があればそれを使う (運営が書いたものを優先)', () => {
    expect(
      resolveCardDescription({ variant: 'text', excerpt: '手書きの抜粋', body: '<p>本文</p>' }),
    ).toBe('手書きの抜粋');
  });

  it('抜粋の前後の空白は落とす', () => {
    expect(resolveCardDescription({ variant: 'cover', excerpt: '  抜粋  ' })).toBe('抜粋');
  });

  it('テキストカードで抜粋が無ければ本文から作る', () => {
    expect(
      resolveCardDescription({ variant: 'text', excerpt: null, body: '<p>本文テキスト</p>' }),
    ).toBe('本文テキスト');
  });

  it('テキストカードで抜粋が空文字でも本文から作る', () => {
    expect(resolveCardDescription({ variant: 'text', excerpt: '', body: '<p>本文</p>' })).toBe(
      '本文',
    );
  });

  it('テキストカードで抜粋が空白のみでも本文から作る', () => {
    expect(resolveCardDescription({ variant: 'text', excerpt: '   ', body: '<p>本文</p>' })).toBe(
      '本文',
    );
  });

  it('画像ありカードでは本文からの自動生成をしない (従来の見た目を変えない)', () => {
    expect(
      resolveCardDescription({ variant: 'cover', excerpt: null, body: '<p>本文</p>' }),
    ).toBeNull();
  });

  it('テキストカードで本文も無ければ null', () => {
    expect(resolveCardDescription({ variant: 'text', excerpt: null, body: null })).toBeNull();
    expect(resolveCardDescription({ variant: 'text', excerpt: null })).toBeNull();
  });

  it('画像のみの本文 + 抜粋なしのテキストカードは null (タイトルだけ表示)', () => {
    expect(
      resolveCardDescription({
        variant: 'text',
        excerpt: null,
        body: '<p><img src="/a.png" /></p>',
      }),
    ).toBeNull();
  });
});
