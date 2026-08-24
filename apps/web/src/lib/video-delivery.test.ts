/**
 * 動画配信経路の決定ロジックのテスト。
 *
 * ここで守りたい仕様は 1 つだけ:
 *   **CloudFront 署名鍵が無くても、HLS 出力バケットが分かっていれば再生できる**
 *
 * 従来は CloudFront の 3 変数が揃わないと必ず再生不能になり、
 * かつその 3 変数のうち KEY_PAIR_ID / PRIVATE_KEY は CDK で自動作成されない
 * (手動の SSM 登録が前提) ため、既定で「エンコードは成功するのに再生できない」
 * 状態になっていた。その回帰を防ぐのが目的。
 */
import {
  resolveDeliveryMode,
  missingDeliveryConfig,
  type DeliveryConfig,
} from './video-delivery';

const cfg = (over: Partial<DeliveryConfig> = {}): DeliveryConfig => ({
  cloudfrontReady: false,
  outputBucket: '',
  ...over,
});

describe('resolveDeliveryMode', () => {
  it('CloudFront が揃っていれば cloudfront を選ぶ (推奨経路)', () => {
    expect(
      resolveDeliveryMode(cfg({ cloudfrontReady: true, outputBucket: 'out-bucket' })),
    ).toBe('cloudfront');
  });

  it('CloudFront が揃っていればバケット名が無くても cloudfront', () => {
    // CloudFront 経路では配信はドメイン経由なのでバケット名は不要
    expect(resolveDeliveryMode(cfg({ cloudfrontReady: true }))).toBe('cloudfront');
  });

  it('★回帰防止: CloudFront 署名鍵が無くても出力バケットがあれば s3 で再生できる', () => {
    expect(resolveDeliveryMode(cfg({ outputBucket: 'out-bucket' }))).toBe('s3');
  });

  it('どちらも無い場合のみ none', () => {
    expect(resolveDeliveryMode(cfg())).toBe('none');
  });
});

describe('missingDeliveryConfig', () => {
  it('配信可能なら欠落なし (cloudfront)', () => {
    expect(missingDeliveryConfig(cfg({ cloudfrontReady: true }))).toEqual([]);
  });

  it('配信可能なら欠落なし (s3 フォールバック)', () => {
    expect(missingDeliveryConfig(cfg({ outputBucket: 'b' }))).toEqual([]);
  });

  it('配信不能なら「どちらを設定すれば直るか」を両方提示する', () => {
    const missing = missingDeliveryConfig(cfg());
    expect(missing).toHaveLength(2);
    expect(missing[0]).toContain('S3_MEDIA_OUTPUT_BUCKET');
    expect(missing[1]).toContain('CLOUDFRONT_VIDEO_DOMAIN');
    expect(missing[1]).toContain('CLOUDFRONT_KEY_PAIR_ID');
    expect(missing[1]).toContain('CLOUDFRONT_PRIVATE_KEY');
  });
});

describe('env からの配信モード解決', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.resetModules();
  });

  function load(fn: (mod: typeof import('./video-delivery')) => void) {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      fn(require('./video-delivery') as typeof import('./video-delivery'));
    });
  }

  it('CloudFront 3 変数が揃っていれば cloudfront', () => {
    process.env.CLOUDFRONT_VIDEO_DOMAIN = 'd1.cloudfront.net';
    process.env.CLOUDFRONT_KEY_PAIR_ID = 'K123';
    process.env.CLOUDFRONT_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----';
    process.env.S3_MEDIA_OUTPUT_BUCKET = 'out';
    load((mod) => {
      expect(mod.currentDeliveryMode()).toBe('cloudfront');
      expect(mod.isVideoDeliveryConfigured()).toBe(true);
    });
  });

  it('★実際の障害ケース: ドメインだけあって鍵が無い → s3 にフォールバックする', () => {
    // ユーザー環境で起きていた状態。CDK は video-domain だけ SSM に自動登録し、
    // key-pair-id / private-key は手動登録なので未設定になりがち。
    process.env.CLOUDFRONT_VIDEO_DOMAIN = 'd1.cloudfront.net';
    delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    delete process.env.CLOUDFRONT_PRIVATE_KEY;
    process.env.S3_MEDIA_OUTPUT_BUCKET = 'out';
    load((mod) => {
      expect(mod.currentDeliveryMode()).toBe('s3');
      // 以前はここが false になり「未設定です」エラーが出ていた
      expect(mod.isVideoDeliveryConfigured()).toBe(true);
    });
  });

  it('出力バケットが未設定でも S3_VIDEO_BUCKET があれば s3 (env のフォールバック)', () => {
    delete process.env.CLOUDFRONT_VIDEO_DOMAIN;
    delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    delete process.env.CLOUDFRONT_PRIVATE_KEY;
    delete process.env.S3_MEDIA_OUTPUT_BUCKET;
    process.env.S3_VIDEO_BUCKET = 'src-bucket';
    load((mod) => {
      expect(mod.currentDeliveryMode()).toBe('s3');
    });
  });

  it('全て未設定なら none', () => {
    delete process.env.CLOUDFRONT_VIDEO_DOMAIN;
    delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    delete process.env.CLOUDFRONT_PRIVATE_KEY;
    delete process.env.S3_MEDIA_OUTPUT_BUCKET;
    delete process.env.S3_VIDEO_BUCKET;
    load((mod) => {
      expect(mod.currentDeliveryMode()).toBe('none');
      expect(mod.isVideoDeliveryConfigured()).toBe(false);
    });
  });
});

describe('resolveThumbnailUrlAsync', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.resetModules();
  });

  function load(fn: (mod: typeof import('./video-delivery')) => Promise<void>) {
    return new Promise<void>((resolve, reject) => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('./video-delivery') as typeof import('./video-delivery');
        fn(mod).then(resolve, reject);
      });
    });
  }

  it('空値は null', async () => {
    await load(async (mod) => {
      expect(await mod.resolveThumbnailUrlAsync(null)).toBeNull();
      expect(await mod.resolveThumbnailUrlAsync(undefined)).toBeNull();
      expect(await mod.resolveThumbnailUrlAsync('')).toBeNull();
    });
  });

  it('http(s) から始まる値はそのまま返す (署名不要な外部URL)', async () => {
    await load(async (mod) => {
      expect(await mod.resolveThumbnailUrlAsync('https://img.example.com/a.jpg')).toBe(
        'https://img.example.com/a.jpg',
      );
    });
  });

  it('配信不能 (none) のときは null を返し、壊れた画像を出さない', async () => {
    delete process.env.CLOUDFRONT_VIDEO_DOMAIN;
    delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    delete process.env.CLOUDFRONT_PRIVATE_KEY;
    delete process.env.S3_MEDIA_OUTPUT_BUCKET;
    delete process.env.S3_VIDEO_BUCKET;
    await load(async (mod) => {
      expect(await mod.resolveThumbnailUrlAsync('hls/v1/thumbnail.0000000.jpg')).toBeNull();
    });
  });

  it('内部パス (DB 保存サムネイル) はそのまま返す', async () => {
    // ここを S3 キーとして署名してしまうと存在しないオブジェクトを指し、
    // S3 未設定環境でアップロードしたサムネイルが全部壊れる。
    await load(async (mod) => {
      const p = '/api/media/video-thumbnail/abc-123?v=1700000000000';
      expect(await mod.resolveThumbnailUrlAsync(p)).toBe(p);
    });
  });

  it('内部パスは配信設定が皆無でも返る (S3 に依存しないため)', async () => {
    delete process.env.CLOUDFRONT_VIDEO_DOMAIN;
    delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    delete process.env.CLOUDFRONT_PRIVATE_KEY;
    delete process.env.S3_MEDIA_OUTPUT_BUCKET;
    delete process.env.S3_VIDEO_BUCKET;
    await load(async (mod) => {
      const p = '/api/media/video-thumbnail/abc-123?v=1';
      expect(await mod.resolveThumbnailUrlAsync(p)).toBe(p);
    });
  });

  it('resolveThumbnailUrls は種類が混ざっていても正しく解決する', async () => {
    delete process.env.CLOUDFRONT_VIDEO_DOMAIN;
    delete process.env.CLOUDFRONT_KEY_PAIR_ID;
    delete process.env.CLOUDFRONT_PRIVATE_KEY;
    delete process.env.S3_MEDIA_OUTPUT_BUCKET;
    delete process.env.S3_VIDEO_BUCKET;
    await load(async (mod) => {
      const out = await mod.resolveThumbnailUrls([
        null,
        'https://img.example.com/a.jpg',
        '/api/media/video-thumbnail/x?v=1',
        'hls/v1/thumbnail.0000000.jpg',
      ]);
      expect(out).toEqual([
        null,
        'https://img.example.com/a.jpg',
        '/api/media/video-thumbnail/x?v=1',
        null,
      ]);
    });
  });
});
