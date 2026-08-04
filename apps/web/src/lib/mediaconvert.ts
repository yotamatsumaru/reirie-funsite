/**
 * AWS Elemental MediaConvert — 動画を HLS (TS セグメント) にエンコードするジョブを作成する。
 *
 * ## フロー
 *   1. 管理者が source 動画を S3 (videoBucket / source/...) にアップロード
 *   2. createHlsJob() で MediaConvert ジョブを投入
 *      - 480p / 720p / 1080p の 3 レンディション (MEDIACONVERT_QUALITIES で変更可)
 *      - HLS_GROUP_SETTINGS で .m3u8 マスタープレイリスト + .ts セグメントを出力
 *      - 出力先: s3://mediaOutputBucket/<outputKeyPrefix>/<videoId>/
 *   3. 完了は EventBridge → Lambda → /api/admin/videos/job-complete で通知され READY 化
 *      (Lambda 未整備でも、管理画面から publish で手動 READY 化が可能)
 *
 * ## バケットが 2 つある理由 (重要)
 *   - 入力  : S3_VIDEO_BUCKET        … 管理者のアップロード受け口 (非公開)
 *   - 出力  : S3_MEDIA_OUTPUT_BUCKET … CloudFront 動画ディストリビューションの
 *                                      オリジン。ここに出力しないと署名付き URL で
 *                                      再生できない (CloudFront が 403/404 を返す)。
 *   S3_MEDIA_OUTPUT_BUCKET 未設定時は videoBucket にフォールバックする
 *   (単一バケット構成でも動くようにするため)。
 *
 * ## 出力キー規約
 *   マスタープレイリストは `<outputKeyPrefix>/<videoId>/index.m3u8` に固定する
 *   (NameModifier を付けない基準名を index とする)。playback API はこの
 *   `s3HlsKey` を CloudFront 署名して返す。
 */
import {
  MediaConvertClient,
  CreateJobCommand,
  DescribeEndpointsCommand,
} from '@aws-sdk/client-mediaconvert';
import { env } from './env';

export type EncodeQuality = '480p' | '720p' | '1080p';

/** 出力可能なレンディションの仕様 (幅 x 高さ / 最大ビットレート) */
const QUALITY_SPEC: Record<
  EncodeQuality,
  { width: number; height: number; maxBitrate: number; qvbrLevel: number }
> = {
  '480p': { width: 854, height: 480, maxBitrate: 1_200_000, qvbrLevel: 7 },
  '720p': { width: 1280, height: 720, maxBitrate: 3_000_000, qvbrLevel: 8 },
  '1080p': { width: 1920, height: 1080, maxBitrate: 6_000_000, qvbrLevel: 8 },
};

const ALL_QUALITIES: EncodeQuality[] = ['480p', '720p', '1080p'];

let _client: MediaConvertClient | null = null;
let _resolvedEndpoint: string | null = null;

/** HLS 出力先バケット (未設定なら videoBucket にフォールバック) */
export function outputBucket(): string {
  return env.s3.mediaOutputBucket || env.s3.videoBucket;
}

/** MediaConvert が設定済み (エンコード実行可能) かどうか */
export function isMediaConvertConfigured(): boolean {
  return Boolean(env.s3.videoBucket && outputBucket() && env.mediaConvert.roleArn);
}

/**
 * 設定の欠落を洗い出して、管理画面に出す診断情報を返す。
 * エンコード「実行」に必須なもの (blocking) と、実行はできるが
 * 「再生」ができないもの (playback) を分けて返す。
 */
export function mediaConvertDiagnostics(): {
  ready: boolean;
  /** エンコード実行に必須で未設定のもの */
  missingRequired: string[];
  /** 再生 (CloudFront 署名付き URL) に必須で未設定のもの */
  missingPlayback: string[];
  /** 完了時の自動 READY 化に必要で未設定のもの */
  missingAutomation: string[];
  /** 現在の解決結果 (画面表示用) */
  resolved: {
    sourceBucket: string;
    outputBucket: string;
    outputKeyPrefix: string;
    region: string;
    qualities: EncodeQuality[];
    segmentSeconds: number;
    usingSingleBucket: boolean;
  };
} {
  const missingRequired: string[] = [];
  if (!env.s3.videoBucket) missingRequired.push('S3_VIDEO_BUCKET');
  if (!outputBucket()) missingRequired.push('S3_MEDIA_OUTPUT_BUCKET');
  if (!env.mediaConvert.roleArn) missingRequired.push('MEDIACONVERT_ROLE_ARN');

  const missingPlayback: string[] = [];
  if (!env.cloudfront.videoDomain) missingPlayback.push('CLOUDFRONT_VIDEO_DOMAIN');
  if (!env.cloudfront.keyPairId) missingPlayback.push('CLOUDFRONT_KEY_PAIR_ID');
  if (!env.cloudfront.privateKey) missingPlayback.push('CLOUDFRONT_PRIVATE_KEY');

  const missingAutomation: string[] = [];
  if (!env.cron.secret) missingAutomation.push('CRON_SECRET');

  return {
    ready: missingRequired.length === 0,
    missingRequired,
    missingPlayback,
    missingAutomation,
    resolved: {
      sourceBucket: env.s3.videoBucket,
      outputBucket: outputBucket(),
      outputKeyPrefix: normalizedPrefix(),
      region: env.aws.region,
      qualities: configuredQualities(),
      segmentSeconds: segmentSeconds(),
      usingSingleBucket:
        Boolean(env.s3.videoBucket) && outputBucket() === env.s3.videoBucket,
    },
  };
}

/** 環境変数で指定されたレンディション一覧 (不正値は無視し、昇順に整える) */
export function configuredQualities(): EncodeQuality[] {
  const raw = env.mediaConvert.qualities
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const picked = ALL_QUALITIES.filter((q) => raw.includes(q));
  // 1 つも一致しなければ既定 (全レンディション) に戻す
  return picked.length > 0 ? picked : ALL_QUALITIES;
}

/** HLS セグメント長 (秒)。1〜30 の範囲に丸める */
function segmentSeconds(): number {
  const n = Math.round(env.mediaConvert.segmentSeconds);
  if (!Number.isFinite(n) || n < 1) return 6;
  return Math.min(30, n);
}

function normalizedPrefix(): string {
  return env.mediaConvert.outputKeyPrefix.replace(/^\/+|\/+$/g, '') || 'hls';
}

/** アカウント固有エンドポイントを解決 (未設定なら describeEndpoints で取得しキャッシュ) */
async function resolveEndpoint(): Promise<string | undefined> {
  if (env.mediaConvert.endpoint) return env.mediaConvert.endpoint;
  if (_resolvedEndpoint) return _resolvedEndpoint;
  const bootstrap = new MediaConvertClient({ region: env.aws.region });
  const res = await bootstrap.send(new DescribeEndpointsCommand({}));
  _resolvedEndpoint = res.Endpoints?.[0]?.Url ?? null;
  return _resolvedEndpoint ?? undefined;
}

async function getClient(): Promise<MediaConvertClient> {
  const endpoint = await resolveEndpoint();
  if (!_client) {
    _client = new MediaConvertClient({
      region: env.aws.region,
      ...(endpoint ? { endpoint } : {}),
    });
  }
  return _client;
}

/** HLS 出力先 (mediaOutputBucket 内) のマスタープレイリスト S3 キー */
export function hlsMasterKey(videoId: string): string {
  return `${normalizedPrefix()}/${videoId}/index.m3u8`;
}

/** サムネイル (先頭フレーム) の S3 キー */
export function thumbnailKey(videoId: string): string {
  return `${normalizedPrefix()}/${videoId}/thumbnail.0000000.jpg`;
}

/**
 * HLS 出力先の S3 URL (MediaConvert Destination 用)。
 * MediaConvert はマスタープレイリスト名を Destination の「最後のパス要素」を
 * 基準名として決めるため、末尾を `.../<videoId>/index` として index.m3u8 を得る。
 * 各レンディションは NameModifier により index_480p.m3u8 等になる。
 */
function hlsDestination(videoId: string): string {
  return `s3://${outputBucket()}/${normalizedPrefix()}/${videoId}/index`;
}

/** サムネイル (FRAME_CAPTURE) の出力先 */
function thumbnailDestination(videoId: string): string {
  return `s3://${outputBucket()}/${normalizedPrefix()}/${videoId}/thumbnail`;
}

/** 1 レンディション分の H.264 / AAC 設定 */
function rendition(quality: EncodeQuality) {
  const { width, height, maxBitrate, qvbrLevel } = QUALITY_SPEC[quality];
  return {
    NameModifier: `_${quality}`,
    ContainerSettings: {
      Container: 'M3U8' as const,
      M3u8Settings: {
        // TS の PMT/PAT を定期挿入し、途中シークでも復帰しやすくする
        PmtPid: 480,
        PatInterval: 0,
        PmtInterval: 0,
      },
    },
    VideoDescription: {
      Width: width,
      Height: height,
      // ソースが縦動画/非16:9でも破綻しないよう、アスペクト比を維持してレターボックス化
      ScalingBehavior: 'DEFAULT' as const,
      Sharpness: 50,
      AntiAlias: 'ENABLED' as const,
      CodecSettings: {
        Codec: 'H_264' as const,
        H264Settings: {
          RateControlMode: 'QVBR' as const,
          MaxBitrate: maxBitrate,
          QvbrSettings: { QvbrQualityLevel: qvbrLevel },
          SceneChangeDetect: 'TRANSITION_DETECTION' as const,
          // ABR 切り替えを成立させるため、全レンディションで GOP 長を揃え
          // セグメント境界に IDR が来るようにする
          GopSize: segmentSeconds(),
          GopSizeUnits: 'SECONDS' as const,
          GopClosedCadence: 1,
          CodecProfile: quality === '1080p' ? ('HIGH' as const) : ('MAIN' as const),
          CodecLevel: 'AUTO' as const,
          AdaptiveQuantization: 'HIGH' as const,
          // 低遅延優先ではなく品質優先 (VOD なので複数パス相当の QVBR で十分)
          QualityTuningLevel: 'SINGLE_PASS_HQ' as const,
          FramerateControl: 'INITIALIZE_FROM_SOURCE' as const,
        },
      },
    },
    AudioDescriptions: [
      {
        AudioSourceName: 'Audio Selector 1',
        CodecSettings: {
          Codec: 'AAC' as const,
          AacSettings: {
            Bitrate: 128_000,
            CodingMode: 'CODING_MODE_2_0' as const,
            SampleRate: 48_000,
            Profile: 'LC' as const,
            RateControlMode: 'CBR' as const,
          },
        },
      },
    ],
    OutputSettings: {
      HlsSettings: {
        // マスタープレイリストに解像度別のストリーム情報を載せる
        AudioGroupId: 'program_audio',
        AudioRenditionSets: 'program_audio',
      },
    },
  };
}

/** サムネイル用 (FRAME_CAPTURE) 出力グループ */
function thumbnailOutputGroup(videoId: string) {
  return {
    Name: 'Thumbnail',
    OutputGroupSettings: {
      Type: 'FILE_GROUP_SETTINGS' as const,
      FileGroupSettings: { Destination: thumbnailDestination(videoId) },
    },
    Outputs: [
      {
        ContainerSettings: { Container: 'RAW' as const },
        Extension: 'jpg',
        VideoDescription: {
          Width: 1280,
          Height: 720,
          ScalingBehavior: 'DEFAULT' as const,
          CodecSettings: {
            Codec: 'FRAME_CAPTURE' as const,
            FrameCaptureSettings: {
              // 動画全体で 1 枚だけ (先頭付近) 取得する
              FramerateNumerator: 1,
              FramerateDenominator: 5,
              MaxCaptures: 1,
              Quality: 80,
            },
          },
        },
      },
    ],
  };
}

/**
 * source 動画 (S3 キー) を HLS にエンコードするジョブを作成する。
 * @returns MediaConvert ジョブ ID
 */
export async function createHlsJob(params: {
  videoId: string;
  s3SourceKey: string;
  /** サムネイルも生成するか (既定 true) */
  withThumbnail?: boolean;
}): Promise<string> {
  const diag = mediaConvertDiagnostics();
  if (!diag.ready) {
    throw new Error(
      `MediaConvert が未設定です (${diag.missingRequired.join(' / ')})`,
    );
  }
  const client = await getClient();
  // 入力はアップロード受け口バケット (videoBucket) から読む
  const input = `s3://${env.s3.videoBucket}/${params.s3SourceKey}`;
  const withThumbnail = params.withThumbnail ?? true;

  const command = new CreateJobCommand({
    Role: env.mediaConvert.roleArn,
    ...(env.mediaConvert.queueArn ? { Queue: env.mediaConvert.queueArn } : {}),
    // 完了通知 (EventBridge) 側で videoId を引けるよう UserMetadata に載せる
    UserMetadata: { videoId: params.videoId },
    // 同一動画の重複投入を MediaConvert 側でも弾けるようにする
    ClientRequestToken: `video-${params.videoId}-${Date.now()}`,
    Settings: {
      Inputs: [
        {
          FileInput: input,
          AudioSelectors: {
            'Audio Selector 1': { DefaultSelection: 'DEFAULT', Offset: 0 },
          },
          VideoSelector: { Rotate: 'AUTO' },
          FilterEnable: 'AUTO',
          TimecodeSource: 'ZEROBASED',
        },
      ],
      OutputGroups: [
        {
          Name: 'Apple HLS',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS' as const,
            HlsGroupSettings: {
              Destination: hlsDestination(params.videoId),
              SegmentLength: segmentSeconds(),
              MinSegmentLength: 0,
              // セグメント長をきっちり守る (ABR 切り替えの安定性優先)
              SegmentControl: 'SEGMENTED_FILES' as const,
              // マスタープレイリストのファイル名を index.m3u8 に固定
              // (Destination + NameModifier 無しの基準名が index になる)
              DirectoryStructure: 'SINGLE_DIRECTORY' as const,
              ManifestDurationFormat: 'INTEGER' as const,
              StreamInfResolution: 'INCLUDE' as const,
              ClientCache: 'ENABLED' as const,
              CodecSpecification: 'RFC_4281' as const,
              OutputSelection: 'MANIFESTS_AND_SEGMENTS' as const,
              ProgramDateTime: 'EXCLUDE' as const,
            },
          },
          Outputs: configuredQualities().map(rendition),
        },
        ...(withThumbnail ? [thumbnailOutputGroup(params.videoId)] : []),
      ],
      TimecodeConfig: { Source: 'ZEROBASED' as const },
    },
    AccelerationSettings: { Mode: 'DISABLED' as const },
    StatusUpdateInterval: 'SECONDS_60' as const,
  });

  const res = await client.send(command);
  const jobId = res.Job?.Id;
  if (!jobId) throw new Error('MediaConvert ジョブ ID が取得できませんでした');
  return jobId;
}
