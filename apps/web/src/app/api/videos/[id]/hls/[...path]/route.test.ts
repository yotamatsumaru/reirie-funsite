/**
 * HLS プロキシ (S3 モード) の統合テスト。
 *
 * ## このテストが守っているもの
 *
 * 本番で「エンコードは READY なのに再生できない」障害が起きた根本原因は
 * **配信URLの経路** にあった。ユニットテストだけでは
 *
 *   - プレイリストの書き換え結果が実際に何を指しているか
 *   - セグメントが本当にバイト列として届くか
 *   - Range (シーク) が壊れていないか
 *
 * が検証できず、通ってしまう。そこで S3 の代わりにローカル HTTP サーバを
 * 立て、**実際のルートハンドラ**を通して検証する。
 *
 * 特に最重要のアサーションは
 * **「プレイリストに S3 の署名付きURL (amazonaws.com) が一切現れないこと」**。
 * ここに S3 の絶対URLが混ざると、ブラウザがクロスオリジンでセグメントを
 * 取得しに行くため出力バケットの CORS 設定が必要になり、
 * 「AWS 側を触らずに再生できる」という前提が壊れる。
 * これは目視では気づけない (プレイヤーだけが失敗する) ため、
 * テストで恒久的に固定する。
 */
import http from 'node:http';

/** MPEG-2 TS 風のダミーセグメント (先頭は同期バイト 0x47) */
function fakeSegment(size: number, seed: number): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i += 188) {
    buf[i] = 0x47; // TS パケットの同期バイト
    if (i + 1 < size) buf[i + 1] = seed;
  }
  return buf;
}

const SEG0 = 'index_720p_00000.ts';
const SEG1 = 'index_720p_00001.ts';
const SEG2 = 'index_720p_00002.ts';

const SEGMENTS: Record<string, Buffer> = {
  [SEG0]: fakeSegment(3760, 1),
  [SEG1]: fakeSegment(3760, 2),
  [SEG2]: fakeSegment(1880, 3),
};

const PLAYLISTS: Record<string, string> = {
  'index.m3u8': [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720',
    'index_720p.m3u8',
    '',
  ].join('\n'),
  'index_720p.m3u8': [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:4',
    '#EXTINF:4.000,',
    SEG0,
    '#EXTINF:4.000,',
    SEG1,
    '#EXTINF:2.000,',
    SEG2,
    '#EXT-X-ENDLIST',
    '',
  ].join('\n'),
};

let server: http.Server;
let origin = '';

jest.mock('@/lib/video-access', () => ({
  requirePlayableVideo: jest.fn(async () => ({
    video: { id: 'vid123', s3HlsKey: 'hls/vid123/index.m3u8', accessLevel: 'MEMBERS' },
    userId: 'u1',
    plan: 'PREMIUM',
  })),
}));

// 配信モードを S3 に固定し、プリサインドの代わりにローカルサーバの URL を返す。
// 「その URL を GET すれば実体が取れる」というプリサインドURLの性質を再現する。
jest.mock('@/lib/video-delivery', () => {
  const actual = jest.requireActual('@/lib/video-delivery');
  return {
    ...actual,
    currentDeliveryMode: () => 's3',
    presignS3Get: async (key: string) => {
      const rel = key.replace(/^hls\/vid123\//, '');
      return `${origin}/${encodeURIComponent(rel)}?X-Amz-Signature=FAKESIG`;
    },
  };
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''));

    const playlist = PLAYLISTS[name];
    if (playlist) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(playlist);
      return;
    }

    const seg = SEGMENTS[name];
    if (!seg) {
      res.writeHead(404).end('not found');
      return;
    }

    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(m?.[1] ?? 0);
      const end = m?.[2] ? Number(m[2]) : seg.length - 1;
      const slice = seg.subarray(start, end + 1);
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${seg.length}`,
        'Content-Length': String(slice.length),
        // S3 / MediaConvert が返しがちな Content-Type。
        // これを透過するとプレイヤーが再生を拒否しうるので矯正が必要。
        'Content-Type': 'binary/octet-stream',
      });
      res.end(slice);
      return;
    }
    res.writeHead(200, {
      'Content-Length': String(seg.length),
      'Content-Type': 'binary/octet-stream',
      ETag: '"tag123"',
      'x-amz-request-id': 'REQ-INTERNAL',
    });
    res.end(seg);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  origin = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string[], init?: RequestInit) {
  const { GET } = await import('./route');
  return GET(new Request('http://app/api', init), {
    params: Promise.resolve({ id: 'vid123', path }),
  });
}

describe('HLS プロキシ: プレイリスト書き換え (S3 モード)', () => {
  it('マスタープレイリストの variant は相対パスのまま (再びプロキシを通す)', async () => {
    const res = await get(['index.m3u8']);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
    expect(await res.text()).toContain('index_720p.m3u8');
  });

  it('メディアプレイリストの全セグメントを自サーバURLに書き換える', async () => {
    const body = await (await get(['index_720p.m3u8'])).text();
    for (const n of ['00000', '00001', '00002']) {
      expect(body).toContain(`/api/videos/vid123/hls/index_720p_${n}.ts`);
    }
    // 素の相対パスが残っていると CloudFront/S3 で 403/404 になる (旧障害)
    expect(body).not.toMatch(/^index_720p_\d+\.ts$/m);
    expect(body).toContain('#EXTINF:');
    expect(body).toContain('#EXT-X-ENDLIST');
  });

  it('★ プレイリストに S3 の署名付きURLを一切含めない (CORS 設定を不要にする)', async () => {
    // ここが最重要。S3 の絶対URLが混ざるとブラウザがクロスオリジンで
    // セグメントを取りに行き、出力バケットの CORS 設定 (= cdk deploy) が
    // 必要になってしまう。同一オリジンに保つことで AWS 側の作業がゼロになる。
    const body = await (await get(['index_720p.m3u8'])).text();
    expect(body).not.toContain('amazonaws.com');
    expect(body).not.toContain('X-Amz-Signature');
    expect(body).not.toContain('127.0.0.1');
    expect(body).not.toMatch(/https?:\/\//);
  });

  it('プレイリストは共有キャッシュ禁止 (権限付きのため)', async () => {
    const res = await get(['index.m3u8']);
    expect(res.headers.get('cache-control')).toContain('private');
    expect(res.headers.get('x-signature-expires-at')).toBeTruthy();
  });
});

describe('HLS プロキシ: セグメント中継 (S3 モード)', () => {
  it('セグメントを実バイト列として過不足なく中継する', async () => {
    const res = await get([SEG0]);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(SEGMENTS[SEG0]!.length);
    expect(buf.equals(SEGMENTS[SEG0]!)).toBe(true);
    // MPEG-2 TS の同期バイト = 動画データとして解釈できる
    expect(buf[0]).toBe(0x47);
  });

  it('上流の binary/octet-stream を video/mp2t に矯正する', async () => {
    const res = await get([SEG1]);
    expect(res.headers.get('content-type')).toBe('video/mp2t');
  });

  it('Accept-Ranges と Content-Length を返す', async () => {
    const res = await get([SEG0]);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe(String(SEGMENTS[SEG0]!.length));
  });

  it('Range リクエストを S3 へ転送し 206 + Content-Range を返す (シーク)', async () => {
    const res = await get([SEG0], { headers: { Range: 'bytes=0-99' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-99\//);
    expect(Buffer.from(await res.arrayBuffer()).length).toBe(100);
  });

  it('セグメントは private キャッシュ (有料コンテンツを共有キャッシュに載せない)', async () => {
    const cc = (await get([SEG0])).headers.get('cache-control') ?? '';
    expect(cc).toContain('private');
    expect(cc).not.toContain('public');
  });

  it('S3 の内部ヘッダをクライアントに漏らさない', async () => {
    const res = await get([SEG0]);
    expect(res.headers.get('x-amz-request-id')).toBeNull();
  });
});

describe('HLS プロキシ: 異常系', () => {
  it('存在しないセグメントは 404', async () => {
    expect((await get(['index_720p_99999.ts'])).status).toBe(404);
  });

  it('存在しないプレイリストは 404', async () => {
    expect((await get(['nope.m3u8'])).status).toBe(404);
  });

  it('ディレクトリトラバーサルを拒否する (他動画の領域を読ませない)', async () => {
    expect((await get(['..', 'other-video', 'index.m3u8'])).status).toBe(400);
  });

  it('パス未指定は 400', async () => {
    expect((await get([])).status).toBe(400);
  });
});
