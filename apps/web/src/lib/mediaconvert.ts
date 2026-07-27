/**
 * AWS Elemental MediaConvert — 動画を HLS (TS セグメント) にエンコードするジョブを作成する。
 *
 * ## フロー
 *   1. 管理者が source 動画を S3 (videoBucket / source/...) にアップロード
 *   2. createHlsJob() で MediaConvert ジョブを投入
 *      - 480p / 720p / 1080p の 3 レンディション
 *      - HLS_GROUP_SETTINGS で .m3u8 マスタープレイリスト + .ts セグメントを出力
 *      - 出力先: s3://videoBucket/<outputKeyPrefix>/<videoId>/
 *   3. 完了は EventBridge → Lambda → /api/admin/videos/job-complete で通知され READY 化
 *      (Lambda 未整備でも、管理画面から publish で手動 READY 化が可能)
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

let _client: MediaConvertClient | null = null;
let _resolvedEndpoint: string | null = null;

/** MediaConvert が設定済み (エンコード実行可能) かどうか */
export function isMediaConvertConfigured(): boolean {
  return Boolean(env.s3.videoBucket && env.mediaConvert.roleArn);
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

/** HLS 出力先 (videoBucket 内) のマスタープレイリスト S3 キー */
export function hlsMasterKey(videoId: string): string {
  const prefix = env.mediaConvert.outputKeyPrefix.replace(/\/+$/, '');
  return `${prefix}/${videoId}/index.m3u8`;
}

/**
 * HLS 出力先の S3 URL (MediaConvert Destination 用)。
 * MediaConvert はマスタープレイリスト名を Destination の「最後のパス要素」を
 * 基準名として決めるため、末尾を `.../<videoId>/index` として index.m3u8 を得る。
 * 各レンディションは NameModifier により index_480p.m3u8 等になる。
 */
function hlsDestination(videoId: string): string {
  const prefix = env.mediaConvert.outputKeyPrefix.replace(/\/+$/, '');
  return `s3://${env.s3.videoBucket}/${prefix}/${videoId}/index`;
}

/** 1 レンディション分の H.264 / AAC 設定 */
function rendition(quality: EncodeQuality) {
  const spec: Record<EncodeQuality, { w: number; h: number; bitrate: number }> = {
    '480p': { w: 854, h: 480, bitrate: 1_200_000 },
    '720p': { w: 1280, h: 720, bitrate: 3_000_000 },
    '1080p': { w: 1920, h: 1080, bitrate: 6_000_000 },
  };
  const { w, h, bitrate } = spec[quality];
  return {
    NameModifier: `_${quality}`,
    ContainerSettings: {
      Container: 'M3U8' as const,
      M3u8Settings: {},
    },
    VideoDescription: {
      Width: w,
      Height: h,
      ScalingBehavior: 'DEFAULT' as const,
      CodecSettings: {
        Codec: 'H_264' as const,
        H264Settings: {
          RateControlMode: 'QVBR' as const,
          MaxBitrate: bitrate,
          QvbrSettings: { QvbrQualityLevel: 7 },
          SceneChangeDetect: 'TRANSITION_DETECTION' as const,
          GopSize: 2,
          GopSizeUnits: 'SECONDS' as const,
        },
      },
    },
    AudioDescriptions: [
      {
        CodecSettings: {
          Codec: 'AAC' as const,
          AacSettings: {
            Bitrate: 96_000,
            CodingMode: 'CODING_MODE_2_0' as const,
            SampleRate: 48_000,
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
}): Promise<string> {
  if (!isMediaConvertConfigured()) {
    throw new Error('MediaConvert が未設定です (S3_VIDEO_BUCKET / MEDIACONVERT_ROLE_ARN)');
  }
  const client = await getClient();
  const input = `s3://${env.s3.videoBucket}/${params.s3SourceKey}`;

  const command = new CreateJobCommand({
    Role: env.mediaConvert.roleArn,
    ...(env.mediaConvert.queueArn ? { Queue: env.mediaConvert.queueArn } : {}),
    // 完了通知 (EventBridge) 側で videoId を引けるよう UserMetadata に載せる
    UserMetadata: { videoId: params.videoId },
    Settings: {
      Inputs: [
        {
          FileInput: input,
          AudioSelectors: { 'Audio Selector 1': { DefaultSelection: 'DEFAULT' } },
          VideoSelector: {},
          TimecodeSource: 'ZEROBASED',
        },
      ],
      OutputGroups: [
        {
          Name: 'Apple HLS',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS',
            HlsGroupSettings: {
              Destination: hlsDestination(params.videoId),
              SegmentLength: 6,
              MinSegmentLength: 0,
              // マスタープレイリストのファイル名を index.m3u8 に固定
              // (Destination + NameModifier 無しの基準名が index になる)
              DirectoryStructure: 'SINGLE_DIRECTORY',
            },
          },
          Outputs: [rendition('480p'), rendition('720p'), rendition('1080p')],
        },
      ],
    },
  });

  const res = await client.send(command);
  const jobId = res.Job?.Id;
  if (!jobId) throw new Error('MediaConvert ジョブ ID が取得できませんでした');
  return jobId;
}
