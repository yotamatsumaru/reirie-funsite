/**
 * Storage Stack
 *  - S3: 動画用 / アセット用 / MediaConvert 出力用
 *  - CloudFront: VOD 用 (signed URL) / 公開アセット用
 *  - CloudFront Public Key & KeyGroup (動画 signed URL)
 *  - MediaConvert 実行ロール + SSM Parameter (アプリが参照する ARN / プレフィックス)
 */
import {
  Stack,
  type StackProps,
  CfnOutput,
  RemovalPolicy,
  Duration,
} from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';

/**
 * HLS 出力の S3 プレフィックス。
 * アプリ側 (MEDIACONVERT_OUTPUT_PREFIX) の既定値と必ず一致させること。
 * MediaConvert ロールの書き込み権限もこのプレフィックスに限定する。
 */
export const HLS_OUTPUT_PREFIX = 'hls';

export interface StorageStackProps extends StackProps {
  config: AppConfig;
  /** 動画 signed URL 用の CloudFront Public Key (PEM) — context で渡す or 別途 SSM */
  cloudfrontPublicKeyPem?: string;
}

export class StorageStack extends Stack {
  public readonly videoBucket: s3.Bucket;
  public readonly assetBucket: s3.Bucket;
  public readonly mediaOutputBucket: s3.Bucket;
  public readonly videoDistribution: cloudfront.Distribution;
  public readonly assetDistribution: cloudfront.Distribution;
  public readonly cloudfrontKeyGroup?: cloudfront.KeyGroup;
  /** 署名付き URL 用の CloudFront Public Key ID (= CLOUDFRONT_KEY_PAIR_ID) */
  public readonly cloudfrontPublicKeyId?: string;
  /** MediaConvert がジョブ実行時に引き受けるサービスロール */
  public readonly mediaConvertRole: iam.Role;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
    const { config, cloudfrontPublicKeyPem } = props;

    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    const removalPolicy = config.destroyOnRemove
      ? RemovalPolicy.DESTROY
      : RemovalPolicy.RETAIN;

    // ---- S3: 動画ソース (アップロード受け口) ----
    this.videoBucket = new s3.Bucket(this, 'VideoBucket', {
      bucketName: `${prefix(config, 'videos')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: config.destroyOnRemove,
      lifecycleRules: [
        {
          id: 'transition-source',
          prefix: 'source/',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: Duration.days(180),
            },
          ],
        },
        {
          id: 'abort-multipart',
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
    });

    // ---- S3: MediaConvert 出力 (HLS) ----
    this.mediaOutputBucket = new s3.Bucket(this, 'MediaOutputBucket', {
      bucketName: `${prefix(config, 'media-output')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: config.destroyOnRemove,
      /**
       * CORS (GET/HEAD) — **現在の再生経路では不要**。将来用の保険として残す。
       *
       * CloudFront 署名鍵が未設定のとき、アプリは S3 から HLS を配信するが
       * (`apps/web/src/lib/video-delivery.ts`)、プリサインド URL を
       * **ブラウザには渡さず、Next.js が中継して同一オリジンで配信する**
       * 実装になっている (`apps/web/src/lib/hls-segment.ts`)。
       * そのためブラウザは S3 へクロスオリジン要求を行わず、
       * この CORS 設定に依存しない = 既存環境で `cdk deploy` は不要。
       *
       * 残している理由: 将来「セグメントを S3 から直接ブラウザへ配る」
       * (帯域をアプリサーバに通さない) 構成に切り替える余地を残すため。
       * 付けていても公開範囲は広がらない (バケットは BLOCK_ALL のままで、
       * プリサインド URL を持つリクエストだけが通る)。
       */
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['Content-Length', 'Content-Range', 'ETag'],
          maxAge: 3000,
        },
      ],
    });

    // ---- S3: 公開アセット (画像など) ----
    this.assetBucket = new s3.Bucket(this, 'AssetBucket', {
      bucketName: `${prefix(config, 'assets')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: config.destroyOnRemove,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    // ---- CloudFront: VOD (signed URL 必須) ----
    const videoOac = new cloudfront.S3OriginAccessControl(this, 'VideoOac', {
      originAccessControlName: prefix(config, 'video-oac'),
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    // signed URL 用の Public Key & KeyGroup (PEM が context で渡された場合のみ作成)
    let trustedKeyGroups: cloudfront.IKeyGroup[] | undefined;
    if (cloudfrontPublicKeyPem) {
      const publicKey = new cloudfront.PublicKey(this, 'VideoSigningPublicKey', {
        publicKeyName: prefix(config, 'video-signing-pk'),
        encodedKey: cloudfrontPublicKeyPem,
        comment: 'Video signed URL public key',
      });
      this.cloudfrontKeyGroup = new cloudfront.KeyGroup(this, 'VideoKeyGroup', {
        keyGroupName: prefix(config, 'video-key-group'),
        items: [publicKey],
      });
      // CLOUDFRONT_KEY_PAIR_ID として使う値 (SSM へ自動登録する)
      this.cloudfrontPublicKeyId = publicKey.publicKeyId;
      trustedKeyGroups = [this.cloudfrontKeyGroup];
    }

    this.videoDistribution = new cloudfront.Distribution(this, 'VideoDistribution', {
      comment: prefix(config, 'video-cdn'),
      priceClass: cloudfront.PriceClass[config.cloudfrontPriceClass],
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.mediaOutputBucket, {
          originAccessControl: videoOac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy:
          cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
        compress: true,
        ...(trustedKeyGroups ? { trustedKeyGroups } : {}),
      },
      defaultRootObject: '',
      enabled: true,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    // ---- CloudFront: 公開アセット ----
    const assetOac = new cloudfront.S3OriginAccessControl(this, 'AssetOac', {
      originAccessControlName: prefix(config, 'asset-oac'),
    });
    this.assetDistribution = new cloudfront.Distribution(this, 'AssetDistribution', {
      comment: prefix(config, 'asset-cdn'),
      priceClass: cloudfront.PriceClass[config.cloudfrontPriceClass],
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.assetBucket, {
          originAccessControl: assetOac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy:
          cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
        compress: true,
      },
      enabled: true,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    // CloudFront → S3 への OAC ポリシー (アセット) は OriginAccessControl が自動で設定
    // 念のため明示的にも policy を追加
    this.assetBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        resources: [this.assetBucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${this.assetDistribution.distributionId}`,
          },
        },
      }),
    );
    this.mediaOutputBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        resources: [this.mediaOutputBucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${this.videoDistribution.distributionId}`,
          },
        },
      }),
    );

    // =================================================================
    // MediaConvert 実行ロール
    // -----------------------------------------------------------------
    // MediaConvert は「ジョブ投入元 (EC2) の権限」ではなく、
    // ジョブに指定された Role を自分で引き受けて S3 を読み書きする。
    // このロールが存在しないとジョブ作成が必ず失敗するため、
    // インフラ側で必ず作成し ARN を SSM に公開する。
    //
    // ロール名は ec2-stack.ts の iam:PassRole 許可
    //   arn:aws:iam::<account>:role/<app>-<env>-mediaconvert-*
    // に一致させる必要がある (末尾 -role で 'mediaconvert-*' にマッチ)。
    //
    // ⚠️ description は必ず ASCII のみ。
    //    IAM API は description に
    //      [\u0009\u000A\u000D\u0020-\u007E\u00A1-\u00FF]*
    //    しか許可しないため、日本語を入れると CreateRole が
    //    HTTP 400 "1 validation error detected: Value at 'description'
    //    failed to satisfy constraint" で失敗しスタックがロールバックする。
    //    (SSM Parameter の description には同じ制約が無いので日本語で良い)
    // =================================================================
    this.mediaConvertRole = new iam.Role(this, 'MediaConvertRole', {
      roleName: prefix(config, 'mediaconvert-role'),
      assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
      // ASCII only (IAM constraint). JP: MediaConvert が HLS エンコード時に S3 を読み書きするためのロール
      description:
        'Service role assumed by AWS Elemental MediaConvert to read source videos from S3 and write HLS output',
    });

    // 入力: ソース動画の読み取り (source/ 配下のみ)
    this.mediaConvertRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadSourceVideos',
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: [this.videoBucket.arnForObjects('source/*')],
      }),
    );
    // 入力バケットの ListBucket (MediaConvert が入力の存在確認に使う)
    this.mediaConvertRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListSourceBucket',
        actions: ['s3:ListBucket', 's3:GetBucketLocation'],
        resources: [this.videoBucket.bucketArn],
      }),
    );
    // 出力: HLS / サムネイルの書き込み (hls/ 配下のみに限定)
    this.mediaConvertRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WriteHlsOutput',
        actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
        resources: [this.mediaOutputBucket.arnForObjects(`${HLS_OUTPUT_PREFIX}/*`)],
      }),
    );
    this.mediaConvertRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListOutputBucket',
        actions: ['s3:ListBucket', 's3:GetBucketLocation'],
        resources: [this.mediaOutputBucket.bucketArn],
      }),
    );

    // =================================================================
    // SSM Parameter (EC2 の user-data / regenerate-env が読み取る)
    // -----------------------------------------------------------------
    // アプリの .env.production は SSM から生成されるため、
    // MediaConvert / CloudFront の設定値は必ずここに公開しておく。
    // CloudFront ドメインは Distribution 作成後に確定するので、
    // 手動登録ではなく CDK から自動で書き込むことで設定漏れを防ぐ。
    // =================================================================
    const ssmBase = `/${config.appName}/${config.envName}`;

    new ssm.StringParameter(this, 'MediaConvertRoleArnParam', {
      parameterName: `${ssmBase}/mediaconvert/role-arn`,
      stringValue: this.mediaConvertRole.roleArn,
      description: 'MediaConvert ジョブに渡す実行ロール ARN (MEDIACONVERT_ROLE_ARN)',
      tier: ssm.ParameterTier.STANDARD,
    });
    new ssm.StringParameter(this, 'MediaConvertOutputPrefixParam', {
      parameterName: `${ssmBase}/mediaconvert/output-prefix`,
      stringValue: HLS_OUTPUT_PREFIX,
      description: 'HLS 出力の S3 プレフィックス (MEDIACONVERT_OUTPUT_PREFIX)',
      tier: ssm.ParameterTier.STANDARD,
    });
    new ssm.StringParameter(this, 'MediaOutputBucketParam', {
      parameterName: `${ssmBase}/s3/media-output-bucket`,
      stringValue: this.mediaOutputBucket.bucketName,
      description: 'HLS 出力先バケット (S3_MEDIA_OUTPUT_BUCKET)',
      tier: ssm.ParameterTier.STANDARD,
    });
    // CloudFront 動画ドメインは Distribution から確定値を書き込む
    // (手動登録では出力バケットのオリジンと不一致になりがちなので自動化する)
    new ssm.StringParameter(this, 'CloudfrontVideoDomainParam', {
      parameterName: `${ssmBase}/cloudfront/video-domain`,
      stringValue: this.videoDistribution.distributionDomainName,
      description: '動画配信 CloudFront ドメイン (CLOUDFRONT_VIDEO_DOMAIN)',
      tier: ssm.ParameterTier.STANDARD,
    });
    new ssm.StringParameter(this, 'CloudfrontAssetDomainParam', {
      parameterName: `${ssmBase}/cloudfront/asset-domain`,
      stringValue: this.assetDistribution.distributionDomainName,
      description: '公開アセット CloudFront ドメイン (CLOUDFRONT_ASSET_DOMAIN)',
      tier: ssm.ParameterTier.STANDARD,
    });
    // 署名用キーペア ID は PEM を context で渡したときのみ確定する
    if (this.cloudfrontKeyGroup) {
      new ssm.StringParameter(this, 'CloudfrontKeyPairIdParam', {
        parameterName: `${ssmBase}/cloudfront/key-pair-id`,
        stringValue: this.cloudfrontPublicKeyId ?? '',
        description: '動画署名付き URL のキーペア ID (CLOUDFRONT_KEY_PAIR_ID)',
        tier: ssm.ParameterTier.STANDARD,
      });
    }

    // ---- Outputs ----
    new CfnOutput(this, 'MediaConvertRoleArn', {
      value: this.mediaConvertRole.roleArn,
      description: 'MEDIACONVERT_ROLE_ARN に設定する値 (SSM にも自動登録済み)',
      exportName: prefix(config, 'mediaconvert-role-arn'),
    });
    new CfnOutput(this, 'VideoBucketName', {
      value: this.videoBucket.bucketName,
      exportName: prefix(config, 'video-bucket'),
    });
    new CfnOutput(this, 'AssetBucketName', {
      value: this.assetBucket.bucketName,
      exportName: prefix(config, 'asset-bucket'),
    });
    new CfnOutput(this, 'MediaOutputBucketName', {
      value: this.mediaOutputBucket.bucketName,
      exportName: prefix(config, 'media-output-bucket'),
    });
    new CfnOutput(this, 'VideoDistributionDomain', {
      value: this.videoDistribution.distributionDomainName,
      exportName: prefix(config, 'video-cdn-domain'),
    });
    new CfnOutput(this, 'AssetDistributionDomain', {
      value: this.assetDistribution.distributionDomainName,
      exportName: prefix(config, 'asset-cdn-domain'),
    });
  }
}
