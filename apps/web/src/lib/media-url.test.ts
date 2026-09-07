import {
  toAbsoluteMediaUrl,
  toAbsoluteUrlListMap,
  toAbsoluteUrlMap,
} from './media-url';

const BASE = 'https://reirie.com';

describe('toAbsoluteMediaUrl', () => {
  it('相対パスに base を前置する（ネイティブアプリはこれが無いと読めない）', () => {
    expect(toAbsoluteMediaUrl('/api/media/character-image/abc', BASE)).toBe(
      'https://reirie.com/api/media/character-image/abc',
    );
  });

  it('キャッシュバスター (?v=...) を落とさない', () => {
    // 画像差し替え後も古い画像が出続けるのを防ぐためのクエリなので、
    // 変換時に消してはいけない。
    expect(toAbsoluteMediaUrl('/api/media/character-image/abc?v=123', BASE)).toBe(
      'https://reirie.com/api/media/character-image/abc?v=123',
    );
  });

  it('すでに絶対 URL (S3/CloudFront) ならそのまま返す', () => {
    const s3 = 'https://assets.example.com/character-images/idle-1-uuid.png';
    expect(toAbsoluteMediaUrl(s3, BASE)).toBe(s3);
    expect(toAbsoluteMediaUrl('http://example.com/a.png', BASE)).toBe(
      'http://example.com/a.png',
    );
  });

  it('プロトコル相対・data URI もそのまま返す', () => {
    expect(toAbsoluteMediaUrl('//cdn.example.com/a.png', BASE)).toBe(
      '//cdn.example.com/a.png',
    );
    expect(toAbsoluteMediaUrl('data:image/png;base64,AAA', BASE)).toBe(
      'data:image/png;base64,AAA',
    );
  });

  it('null / undefined / 空文字 / 空白のみ は null', () => {
    expect(toAbsoluteMediaUrl(null, BASE)).toBeNull();
    expect(toAbsoluteMediaUrl(undefined, BASE)).toBeNull();
    expect(toAbsoluteMediaUrl('', BASE)).toBeNull();
    expect(toAbsoluteMediaUrl('   ', BASE)).toBeNull();
  });

  it('base の末尾スラッシュで二重スラッシュにならない', () => {
    expect(toAbsoluteMediaUrl('/a.png', 'https://reirie.com/')).toBe(
      'https://reirie.com/a.png',
    );
    expect(toAbsoluteMediaUrl('/a.png', 'https://reirie.com///')).toBe(
      'https://reirie.com/a.png',
    );
  });

  it('先頭スラッシュが無い相対パスも扱える', () => {
    expect(toAbsoluteMediaUrl('api/media/x', BASE)).toBe('https://reirie.com/api/media/x');
  });

  it('localhost の base でも動く（開発環境）', () => {
    expect(toAbsoluteMediaUrl('/api/media/x', 'http://localhost:3000')).toBe(
      'http://localhost:3000/api/media/x',
    );
  });
});

describe('toAbsoluteUrlMap', () => {
  it('各値を絶対 URL に変換する', () => {
    const out = toAbsoluteUrlMap({ win: '/api/media/game-audio/w', lose: '/x/l.mp3' }, BASE);
    expect(out).toEqual({
      win: 'https://reirie.com/api/media/game-audio/w',
      lose: 'https://reirie.com/x/l.mp3',
    });
  });

  it('値が空のスロットはキーごと落とす', () => {
    // 「キーはあるが null」だと、クライアントが «未設定» と
    // «読み込み失敗» を区別できない。
    const out = toAbsoluteUrlMap({ win: '', lose: '/l.mp3' } as Record<string, string>, BASE);
    expect(out).toEqual({ lose: 'https://reirie.com/l.mp3' });
    expect('win' in out).toBe(false);
  });

  it('空マップなら空マップ', () => {
    expect(toAbsoluteUrlMap({}, BASE)).toEqual({});
  });

  it('S3 の絶対 URL はそのまま保つ', () => {
    const out = toAbsoluteUrlMap({ win: 'https://cdn.example.com/w.mp3' }, BASE);
    expect(out.win).toBe('https://cdn.example.com/w.mp3');
  });
});

describe('toAbsoluteUrlListMap', () => {
  it('variant マップを URL 配列に変換する', () => {
    const out = toAbsoluteUrlListMap(
      { idle: { 1: '/a.png', 2: '/b.png' } },
      BASE,
    );
    expect(out).toEqual({
      idle: ['https://reirie.com/a.png', 'https://reirie.com/b.png'],
    });
  });

  it('variant 番号の昇順で安定した順序になる', () => {
    // 順序が実行ごとに変わると表示のテストや不具合の再現がしにくい。
    const out = toAbsoluteUrlListMap({ idle: { 3: '/c.png', 1: '/a.png', 2: '/b.png' } }, BASE);
    expect(out.idle).toEqual([
      'https://reirie.com/a.png',
      'https://reirie.com/b.png',
      'https://reirie.com/c.png',
    ]);
  });

  it('variant が歯抜け (1 と 3 のみ) でも配列に詰める', () => {
    // アプリ側が «2 番が無い» ことを気にせず「ランダムに1つ選ぶ」だけで
    // 済むようにするのが配列化の目的。
    const out = toAbsoluteUrlListMap({ up: { 1: '/a.png', 3: '/c.png' } }, BASE);
    expect(out.up).toEqual(['https://reirie.com/a.png', 'https://reirie.com/c.png']);
  });

  it('全部空のスロットはキーごと落とす', () => {
    const out = toAbsoluteUrlListMap({ idle: { 1: '' }, up: { 1: '/u.png' } }, BASE);
    expect('idle' in out).toBe(false);
    expect(out.up).toEqual(['https://reirie.com/u.png']);
  });

  it('空マップ / undefined スロットで壊れない', () => {
    expect(toAbsoluteUrlListMap({}, BASE)).toEqual({});
    expect(toAbsoluteUrlListMap({ idle: undefined }, BASE)).toEqual({});
  });

  it('S3 と DB フォールバックが混在しても両方正しく扱える', () => {
    // 一部のポーズだけ後から S3 に上げ直した、という状態を想定。
    const out = toAbsoluteUrlListMap(
      { idle: { 1: 'https://cdn.example.com/i1.png', 2: '/api/media/character-image/x?v=9' } },
      BASE,
    );
    expect(out.idle).toEqual([
      'https://cdn.example.com/i1.png',
      'https://reirie.com/api/media/character-image/x?v=9',
    ]);
  });
});
