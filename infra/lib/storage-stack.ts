/**
 * Storage Stack
 *  - S3: 動画用 / アセット用 / MediaConvert 出力用
 *  - CloudFront: VOD 用 (signed URL) / 公開アセット用
 *  - CloudFront Public Key & KeyGroup (動画 signed URL)
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
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';

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

    // ---- Outputs ----
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
