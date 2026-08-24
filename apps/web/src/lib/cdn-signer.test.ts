/**
 * cdn-signer のテスト。
 *
 * `env` は import 時に評価されるため、CloudFront 設定を注入するために
 * `jest.isolateModules` + `process.env` 差し替えで読み込み直す。
 */
import { hlsDirPrefix } from './cdn-signer';
import { hlsFileName, hlsProxyUrl } from './hls-proxy-url';

describe('hlsDirPrefix', () => {
  it.each([
    ['hls/vid123/index.m3u8', 'hls/vid123/'],
    ['hls/vid123/index_720p.m3u8', 'hls/vid123/'],
    ['/hls/vid123/index.m3u8', 'hls/vid123/'],
    ['///hls/vid123/index.m3u8', 'hls/vid123/'],
    ['a/b/c/d/index.m3u8', 'a/b/c/d/'],
    ['index.m3u8', ''],
    ['', ''],
  ])('%s → %s', (key, expected) => {
    expect(hlsDirPrefix(key)).toBe(expected);
  });
});

describe('hlsFileName', () => {
  it.each([
    ['hls/vid123/index.m3u8', 'index.m3u8'],
    ['hls/vid123/index_720p.m3u8', 'index_720p.m3u8'],
    ['/hls/vid123/index.m3u8', 'index.m3u8'],
    ['index.m3u8', 'index.m3u8'],
    ['', 'index.m3u8'],
    ['hls/vid123/', 'index.m3u8'],
  ])('%s → %s', (key, expected) => {
    expect(hlsFileName(key)).toBe(expected);
  });
});

describe('hlsProxyUrl', () => {
  it('プロキシの相対URLを組み立てる', () => {
    expect(hlsProxyUrl('vid123', 'hls/vid123/index.m3u8')).toBe(
      '/api/videos/vid123/hls/index.m3u8',
    );
  });

  it('videoId をエスケープする', () => {
    expect(hlsProxyUrl('a/b', 'hls/x/index.m3u8')).toBe('/api/videos/a%2Fb/hls/index.m3u8');
  });
});

// --- 署名の実挙動 (設定あり) ---

const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1sMhP0BiOSFxvS9lJXWxSg8i4uH9BeIB7hbYzWMBqECBu1JC
-----END RSA PRIVATE KEY-----`;

describe('signVideoUrl (未設定時)', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.resetModules();
  });

  it('CloudFront 未設定なら signed:false のダミーURLを返す', () => {
    delete process.env.CLOUDFRONT_VIDEO_DOMAIN;
    delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    delete process.env.CLOUDFRONT_PRIVATE_KEY;

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./cdn-signer') as typeof import('./cdn-signer');
      expect(mod.isVideoCdnConfigured()).toBe(false);
      const res = mod.signVideoUrl('hls/vid123/index.m3u8');
      expect(res.signed).toBe(false);
      expect(res.url).toContain('?dev=1');
    });
  });
});

describe('signVideoUrl (設定あり)', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.CLOUDFRONT_VIDEO_DOMAIN = 'd111111abcdef8.cloudfront.net';
    process.env.CLOUDFRONT_KEY_PAIR_ID = 'K123ABC';
    process.env.CLOUDFRONT_PRIVATE_KEY = TEST_PRIVATE_KEY;
  });

  afterEach(() => {
    process.env = { ...original };
    jest.resetModules();
  });

  function withSigner(fn: (mod: typeof import('./cdn-signer')) => void) {
    jest.isolateModules(() => {
      jest.doMock('@aws-sdk/cloudfront-signer', () => ({
        // 署名生成は AWS SDK に任せる部分なのでモックし、
        // 「どのポリシーで呼ばれたか」を検証する
        getSignedUrl: (args: {
          url: string;
          policy?: string;
          dateLessThan?: string;
          keyPairId: string;
        }) => {
          const q = args.policy
            ? `Policy=${encodeURIComponent(args.policy)}&Key-Pair-Id=${args.keyPairId}&Signature=SIG`
            : `Expires=999&Key-Pair-Id=${args.keyPairId}&Signature=SIG`;
          return `${args.url}?${q}`;
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      fn(require('./cdn-signer') as typeof import('./cdn-signer'));
    });
  }

  it('既定 (wildcard=true) はカスタムポリシーで署名する', () => {
    withSigner((mod) => {
      const res = mod.signVideoUrl('hls/vid123/index.m3u8');
      expect(res.signed).toBe(true);
      expect(res.url).toContain('Policy=');
      expect(res.url).not.toContain('Expires=');
    });
  });

  it('カスタムポリシーの Resource は hls/<videoId>/* になる', () => {
    withSigner((mod) => {
      const res = mod.signVideoUrl('hls/vid123/index.m3u8');
      const policy = decodeURIComponent(
        new URL(res.url).searchParams.get('Policy') ?? '',
      );
      const parsed = JSON.parse(policy) as {
        Statement: Array<{ Resource: string; Condition: Record<string, unknown> }>;
      };
      expect(parsed.Statement[0]?.Resource).toBe(
        'https://d111111abcdef8.cloudfront.net/hls/vid123/*',
      );
    });
  });

  it('カスタムポリシーに DateLessThan(EpochTime) が入る', () => {
    withSigner((mod) => {
      const res = mod.signVideoUrl('hls/vid123/index.m3u8', 3600);
      const policy = decodeURIComponent(
        new URL(res.url).searchParams.get('Policy') ?? '',
      );
      const parsed = JSON.parse(policy) as {
        Statement: Array<{ Condition: { DateLessThan: { 'AWS:EpochTime': number } } }>;
      };
      const epoch = parsed.Statement[0]?.Condition.DateLessThan['AWS:EpochTime'];
      expect(typeof epoch).toBe('number');
      expect(epoch).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  it('wildcard=false は canned policy (Expires) で署名する', () => {
    withSigner((mod) => {
      const res = mod.signVideoUrl('hls/vid123/thumbnail.0000000.jpg', 3600, false);
      expect(res.url).toContain('Expires=');
      expect(res.url).not.toContain('Policy=');
    });
  });

  it('サムネイルは単独ファイル署名 (Policy を含まない)', () => {
    withSigner((mod) => {
      const url = mod.resolveThumbnailUrl('hls/vid123/thumbnail.0000000.jpg');
      expect(url).not.toBeNull();
      expect(url).toContain('Expires=');
      expect(url).not.toContain('Policy=');
    });
  });

  it('http(s) から始まるサムネイルはそのまま返す', () => {
    withSigner((mod) => {
      expect(mod.resolveThumbnailUrl('https://img.example.com/a.jpg')).toBe(
        'https://img.example.com/a.jpg',
      );
    });
  });

  it('先頭スラッシュは正規化される', () => {
    withSigner((mod) => {
      const res = mod.signVideoUrl('/hls/vid123/index.m3u8');
      expect(res.url.startsWith('https://d111111abcdef8.cloudfront.net/hls/vid123/index.m3u8')).toBe(
        true,
      );
    });
  });
});
