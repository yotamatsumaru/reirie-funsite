import {
  extractSignatureQuery,
  appendQuery,
  isPlaylistUri,
  rewritePlaylist,
  looksLikeCloudFrontSignature,
  inheritQuery,
  collectPlaylistUris,
} from './hls-rewrite';

const SIG = 'Policy=eyJTdGF0ZW1lbnQ&Key-Pair-Id=K123ABC&Signature=abc~def_';
const BASE = 'https://d111111abcdef8.cloudfront.net/hls/vid123/';

describe('extractSignatureQuery', () => {
  it('クエリを先頭の ? を除いて返す', () => {
    expect(extractSignatureQuery(`https://cdn.example.com/a.m3u8?${SIG}`)).toBe(SIG);
  });

  it('クエリが無ければ空文字', () => {
    expect(extractSignatureQuery('https://cdn.example.com/a.m3u8')).toBe('');
  });

  it('ハッシュ以降は含めない', () => {
    expect(extractSignatureQuery('https://cdn.example.com/a.m3u8?x=1#frag')).toBe('x=1');
  });

  it('? 直後が空なら空文字', () => {
    expect(extractSignatureQuery('https://cdn.example.com/a.m3u8?')).toBe('');
  });
});

describe('appendQuery', () => {
  it('クエリなしURLには ? を付けて追加する', () => {
    expect(appendQuery('https://cdn.example.com/a.ts', SIG)).toBe(
      `https://cdn.example.com/a.ts?${SIG}`,
    );
  });

  it('query が空なら何もしない', () => {
    expect(appendQuery('https://cdn.example.com/a.ts', '')).toBe('https://cdn.example.com/a.ts');
  });

  it('同じキーが既にあれば二重付与しない', () => {
    const already = `https://cdn.example.com/a.ts?${SIG}`;
    expect(appendQuery(already, SIG)).toBe(already);
  });

  it('別のクエリがある場合は & で連結する', () => {
    expect(appendQuery('https://cdn.example.com/a.ts?v=2', SIG)).toBe(
      `https://cdn.example.com/a.ts?v=2&${SIG}`,
    );
  });

  it('ハッシュはクエリの後ろに残す', () => {
    expect(appendQuery('https://cdn.example.com/a.ts#f', 'x=1')).toBe(
      'https://cdn.example.com/a.ts?x=1#f',
    );
  });
});

describe('isPlaylistUri', () => {
  it.each([
    ['index.m3u8', true],
    ['index_720p.m3u8', true],
    ['index.m3u', true],
    ['index.m3u8?Policy=x', true],
    ['index_720p_00001.ts', false],
    ['thumbnail.0000000.jpg', false],
    ['', false],
  ])('%s → %s', (uri, expected) => {
    expect(isPlaylistUri(uri)).toBe(expected);
  });
});

describe('rewritePlaylist (master playlist)', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480',
    'index_480p.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720',
    'index_720p.m3u8',
    '',
  ].join('\n');

  it('variant playlist は playlistUrl で解決される (プロキシに残す)', () => {
    const out = rewritePlaylist(master, {
      segmentBase: BASE,
      signatureQuery: SIG,
      playlistUrl: (rel) => rel,
    });
    expect(out).toContain('\nindex_480p.m3u8\n');
    expect(out).toContain('\nindex_720p.m3u8\n');
    // playlist に署名クエリを付けない (プロキシ側で再署名するため)
    expect(out).not.toContain(`index_480p.m3u8?${SIG}`);
  });

  it('playlistUrl 未指定なら variant も CloudFront 直 + 署名になる', () => {
    const out = rewritePlaylist(master, { segmentBase: BASE, signatureQuery: SIG });
    expect(out).toContain(`${BASE}index_480p.m3u8?${SIG}`);
  });

  it('タグ行はそのまま保持される', () => {
    const out = rewritePlaylist(master, {
      segmentBase: BASE,
      signatureQuery: SIG,
      playlistUrl: (rel) => rel,
    });
    expect(out).toContain('#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480');
    expect(out.startsWith('#EXTM3U')).toBe(true);
  });
});

describe('rewritePlaylist (media playlist)', () => {
  const media = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    '#EXTINF:6.000,',
    'index_720p_00001.ts',
    '#EXTINF:6.000,',
    'index_720p_00002.ts',
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');

  it('.ts セグメントに署名クエリ付き絶対URLを埋め込む', () => {
    const out = rewritePlaylist(media, { segmentBase: BASE, signatureQuery: SIG });
    expect(out).toContain(`${BASE}index_720p_00001.ts?${SIG}`);
    expect(out).toContain(`${BASE}index_720p_00002.ts?${SIG}`);
  });

  it('EXTINF などのタグは壊さない', () => {
    const out = rewritePlaylist(media, { segmentBase: BASE, signatureQuery: SIG });
    expect(out).toContain('#EXTINF:6.000,');
    expect(out).toContain('#EXT-X-ENDLIST');
  });

  it('CRLF 改行を保持する', () => {
    const crlf = '#EXTM3U\r\n#EXTINF:6.000,\r\nseg.ts\r\n';
    const out = rewritePlaylist(crlf, { segmentBase: BASE, signatureQuery: SIG });
    expect(out).toBe(`#EXTM3U\r\n#EXTINF:6.000,\r\n${BASE}seg.ts?${SIG}\r\n`);
  });

  it('./ 付きの相対パスを正規化する', () => {
    const out = rewritePlaylist('#EXTM3U\n./seg.ts\n', {
      segmentBase: BASE,
      signatureQuery: SIG,
    });
    expect(out).toContain(`${BASE}seg.ts?${SIG}`);
  });

  it('絶対URLは書き換えない', () => {
    const out = rewritePlaylist('#EXTM3U\nhttps://other.example.com/seg.ts\n', {
      segmentBase: BASE,
      signatureQuery: SIG,
    });
    expect(out).toContain('https://other.example.com/seg.ts');
    expect(out).not.toContain(BASE);
  });

  it('URI="..." 属性 (EXT-X-KEY / EXT-X-MAP) を書き換える', () => {
    const out = rewritePlaylist('#EXT-X-MAP:URI="init.mp4"\nseg.m4s\n', {
      segmentBase: BASE,
      signatureQuery: SIG,
    });
    expect(out).toContain(`URI="${BASE}init.mp4?${SIG}"`);
    expect(out).toContain(`${BASE}seg.m4s?${SIG}`);
  });

  it('空の URI="" は触らない', () => {
    const out = rewritePlaylist('#EXT-X-MEDIA:URI=""\n', {
      segmentBase: BASE,
      signatureQuery: SIG,
    });
    expect(out).toContain('URI=""');
  });

  it('空文字入力は空文字を返す', () => {
    expect(rewritePlaylist('', { segmentBase: BASE, signatureQuery: SIG })).toBe('');
  });
});

describe('looksLikeCloudFrontSignature', () => {
  it.each([
    [SIG, true],
    ['Expires=123&Key-Pair-Id=K1&Signature=s', true],
    ['Signature=abc', true],
    ['v=2&t=3', false],
    ['', false],
    ['MyPolicy=1', false],
  ])('%s → %s', (q, expected) => {
    expect(looksLikeCloudFrontSignature(q)).toBe(expected);
  });
});

describe('inheritQuery', () => {
  const base = `${BASE}index.m3u8?${SIG}`;

  it('同一オリジンでクエリ無しなら署名を引き継ぐ', () => {
    const out = inheritQuery(`${BASE}index_720p_00001.ts`, base, SIG);
    expect(out).toContain('Policy=');
    expect(out).toContain('Signature=');
  });

  it('相対URLも base で解決してから引き継ぐ', () => {
    const out = inheritQuery('index_720p_00001.ts', base, SIG);
    expect(out.startsWith(BASE)).toBe(true);
    expect(out).toContain('Key-Pair-Id=K123ABC');
  });

  it('既にクエリがあれば触らない', () => {
    const url = `${BASE}seg.ts?already=1`;
    expect(inheritQuery(url, base, SIG)).toBe(url);
  });

  it('別オリジンには引き継がない', () => {
    const url = 'https://evil.example.com/seg.ts';
    expect(inheritQuery(url, base, SIG)).toBe(url);
  });

  it('query が空なら何もしない', () => {
    const url = `${BASE}seg.ts`;
    expect(inheritQuery(url, base, '')).toBe(url);
  });

  it('base が不正なら url をそのまま返す', () => {
    const url = 'seg.ts';
    expect(inheritQuery(url, 'not-a-url', SIG)).toBe(url);
  });
});

// ---------------------------------------------------------------------------
// S3 プリサインド フォールバック用の追加ロジック
//
// CloudFront はワイルドカード署名で 1 つのクエリを全セグメントに使えるが、
// S3 プリサインドは **オブジェクトごとに署名が必要**。そのため
//  1. collectPlaylistUris で署名すべき URI を全部集める
//  2. segmentUrl で URI ごとの署名済み URL を差し込む
// という 2 段構えになる。
// ---------------------------------------------------------------------------

describe('collectPlaylistUris', () => {
  it('セグメントとプレイリストを分けて集める', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000',
      'index_480p.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000',
      'index_720p.m3u8',
    ].join('\n');
    const { playlists, segments } = collectPlaylistUris(master);
    expect(playlists).toEqual(['index_480p.m3u8', 'index_720p.m3u8']);
    expect(segments).toEqual([]);
  });

  it('メディアプレイリストの .ts を集める', () => {
    const media = [
      '#EXTM3U',
      '#EXTINF:6.000,',
      'seg_00001.ts',
      '#EXTINF:6.000,',
      'seg_00002.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const { segments } = collectPlaylistUris(media);
    expect(segments).toEqual(['seg_00001.ts', 'seg_00002.ts']);
  });

  it('重複は 1 回だけ (署名の無駄打ちを避ける)', () => {
    const body = '#EXTM3U\nseg.ts\nseg.ts\n';
    expect(collectPlaylistUris(body).segments).toEqual(['seg.ts']);
  });

  it('絶対URL は署名対象にしない', () => {
    const body = '#EXTM3U\nhttps://other.example.com/seg.ts\nlocal.ts\n';
    expect(collectPlaylistUris(body).segments).toEqual(['local.ts']);
  });

  it('タグ内の URI="..." も集める (EXT-X-MAP / EXT-X-KEY)', () => {
    const body =
      '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nseg.m4s\n';
    const { segments } = collectPlaylistUris(body);
    expect(segments).toContain('init.mp4');
    expect(segments).toContain('key.bin');
    expect(segments).toContain('seg.m4s');
  });

  it('./ 付きの相対パスを正規化する', () => {
    expect(collectPlaylistUris('#EXTM3U\n./seg.ts\n').segments).toEqual(['seg.ts']);
  });

  it('空行・タグのみでも壊れない', () => {
    const { playlists, segments } = collectPlaylistUris('#EXTM3U\n\n#EXT-X-ENDLIST\n');
    expect(playlists).toEqual([]);
    expect(segments).toEqual([]);
  });
});

describe('rewritePlaylist (segmentUrl = S3 プリサインド経路)', () => {
  const media = ['#EXTM3U', '#EXTINF:6.000,', 'seg1.ts', '#EXTINF:6.000,', 'seg2.ts', ''].join(
    '\n',
  );

  it('URI ごとに個別の署名済みURLを差し込む', () => {
    const map = new Map([
      ['seg1.ts', 'https://s3.example.com/hls/v1/seg1.ts?X-Amz-Signature=AAA'],
      ['seg2.ts', 'https://s3.example.com/hls/v1/seg2.ts?X-Amz-Signature=BBB'],
    ]);
    const out = rewritePlaylist(media, {
      segmentBase: '',
      signatureQuery: '',
      segmentUrl: (rel) => map.get(rel),
    });
    expect(out).toContain('seg1.ts?X-Amz-Signature=AAA');
    expect(out).toContain('seg2.ts?X-Amz-Signature=BBB');
    // 署名が混ざっていないこと (セグメントごとに別署名であること)
    expect(out).not.toContain('seg1.ts?X-Amz-Signature=BBB');
  });

  it('segmentUrl が undefined を返した URI は segmentBase にフォールバックする', () => {
    const out = rewritePlaylist(media, {
      segmentBase: BASE,
      signatureQuery: SIG,
      segmentUrl: (rel) => (rel === 'seg1.ts' ? 'https://signed.example.com/seg1.ts?s=1' : undefined),
    });
    expect(out).toContain('https://signed.example.com/seg1.ts?s=1');
    expect(out).toContain(`${BASE}seg2.ts?${SIG}`);
  });

  it('variant playlist は segmentUrl より playlistUrl が優先される', () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex_720p.m3u8\n';
    const out = rewritePlaylist(master, {
      segmentBase: '',
      signatureQuery: '',
      playlistUrl: (rel) => rel,
      segmentUrl: () => 'https://should-not-be-used.example.com/x',
    });
    expect(out).toContain('\nindex_720p.m3u8\n');
    expect(out).not.toContain('should-not-be-used');
  });

  it('タグと改行を壊さない', () => {
    const out = rewritePlaylist('#EXTM3U\r\n#EXTINF:6.000,\r\nseg1.ts\r\n', {
      segmentBase: '',
      signatureQuery: '',
      segmentUrl: () => 'https://s3.example.com/seg1.ts?sig=1',
    });
    expect(out).toBe('#EXTM3U\r\n#EXTINF:6.000,\r\nhttps://s3.example.com/seg1.ts?sig=1\r\n');
  });
});
