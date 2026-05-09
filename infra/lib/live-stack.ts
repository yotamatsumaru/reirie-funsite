/**
 * Live Stack (Amazon IVS)
 *  - IVS Channel (privacy=PRIVATE)
 *  - Playback Key Pair (signed playback URL 用)
 *  - Recording Configuration (S3 へ自動録画)
 *
 *  NOTE: 配信URL/StreamKey は CDK Output から取得。
 *        Playback の Private Key は別途 SSM Parameter Store に保存して EC2 から参照。
 */
import {
  Stack,
  type StackProps,
  CfnOutput,
  RemovalPolicy,
} from 'aws-cdk-lib';
import * as ivs from 'aws-cdk-lib/aws-ivs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';

export interface LiveStackProps extends StackProps {
  config: AppConfig;
  /** 録画保存先バケット (Storage Stack の mediaOutputBucket を渡す or 専用作成) */
  recordingBucket?: s3.IBucket;
  /** Playback PublicKey PEM (EC コマンドで生成した EC public key) */
  playbackPublicKeyPem?: string;
}

export class LiveStack extends Stack {
  public readonly channel: ivs.CfnChannel;
  public readonly recordingConfig: ivs.CfnRecordingConfiguration;
  public readonly playbackKeyPair?: ivs.CfnPlaybackKeyPair;
  public readonly recordingBucket: s3.IBucket;

  constructor(scope: Construct, id: string, props: LiveStackProps) {
    super(scope, id, props);
    const { config, recordingBucket, playbackPublicKeyPem } = props;

    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    // 録画用バケット (Storage から渡されない場合は専用バケットを作成)
    this.recordingBucket =
      recordingBucket ??
      new s3.Bucket(this, 'IvsRecordingBucket', {
        bucketName: `${prefix(config, 'ivs-recordings')}-${this.account}`,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        removalPolicy: config.destroyOnRemove ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
        autoDeleteObjects: config.destroyOnRemove,
      });

    // Recording Configuration
    this.recordingConfig = new ivs.CfnRecordingConfiguration(this, 'IvsRecordingConfig', {
      name: prefix(config, 'ivs-recording'),
      destinationConfiguration: {
        s3: {
          bucketName: this.recordingBucket.bucketName,
        },
      },
      thumbnailConfiguration: {
        recordingMode: 'INTERVAL',
        targetIntervalSeconds: 60,
      },
    });

    // IVS Channel (PRIVATE)
    this.channel = new ivs.CfnChannel(this, 'IvsChannel', {
      name: prefix(config, 'ivs-channel'),
      type: 'STANDARD',
      latencyMode: 'LOW',
      authorized: true, // Private (Playback Authorization)
      recordingConfigurationArn: this.recordingConfig.attrArn,
      tags: Object.entries(commonTags(config)).map(([k, v]) => ({ key: k, value: v })),
    });

    // Playback Key Pair (signed playback URL 用)
    if (playbackPublicKeyPem) {
      this.playbackKeyPair = new ivs.CfnPlaybackKeyPair(this, 'IvsPlaybackKeyPair', {
        name: prefix(config, 'ivs-playback-pk'),
        publicKeyMaterial: playbackPublicKeyPem,
      });
    }

    // ---- Outputs ----
    new CfnOutput(this, 'IvsChannelArn', {
      value: this.channel.attrArn,
      exportName: prefix(config, 'ivs-channel-arn'),
    });
    new CfnOutput(this, 'IvsIngestEndpoint', {
      value: this.channel.attrIngestEndpoint,
      exportName: prefix(config, 'ivs-ingest-endpoint'),
    });
    new CfnOutput(this, 'IvsPlaybackUrl', {
      value: this.channel.attrPlaybackUrl,
      exportName: prefix(config, 'ivs-playback-url'),
    });
    if (this.playbackKeyPair) {
      new CfnOutput(this, 'IvsPlaybackKeyPairArn', {
        value: this.playbackKeyPair.attrArn,
        exportName: prefix(config, 'ivs-playback-pk-arn'),
      });
    }
    new CfnOutput(this, 'IvsRecordingBucket', {
      value: this.recordingBucket.bucketName,
      exportName: prefix(config, 'ivs-recording-bucket'),
    });
  }
}
