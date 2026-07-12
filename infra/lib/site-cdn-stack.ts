/**
 * Site CDN Stack
 *  - CloudFront ディストリビューション (メインドメイン用、オリジン = EC2)
 *  - Route 53: reirie.com / www.reirie.com の ALIAS レコード → CloudFront
 *  - Route 53: EC2 の EIP に対する内部オリジン A レコード
 *              (CloudFront のカスタムオリジンは IP を直接指定できないため、
 *               安定したホスト名 (origin-app.<domain>) を用意する)
 *
 * Host ヘッダーについての設計判断:
 *  - CloudFront はオリジンへの Host ヘッダーを内部オリジンのホスト名
 *    (origin-app.<domain>) に書き換えるため、reirie.com / www.reirie.com の
 *    どちらでアクセスされたかがオリジン側から見えなくなる。
 *  - そのため CloudFront Function (viewer-request) で、書き換え前の元の
 *    Host ヘッダーを `X-Forwarded-Host` カスタムヘッダーにコピーしてから
 *    オリジンに転送する。Origin Request Policy は
 *    ALL_VIEWER_EXCEPT_HOST_HEADER (Host 以外は全て転送、Host だけ
 *    CloudFront がオリジン向けに管理) を使う。
 *  - EC2 側 (nginx) は `proxy_set_header X-Forwarded-Host $http_x_forwarded_host;`
 *    で Next.js に橋渡しし、Auth.js / APP_BASE_URL が正しいドメインを
 *    認識できるようにする (deploy/user-data.sh 側で対応)。
 */
import { Stack, type StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';

export interface SiteCdnStackProps extends StackProps {
  config: AppConfig;
  domainName: string;
  hostedZone: route53.IHostedZone;
  /** DnsStack (us-east-1) で発行した ACM 証明書 (reirie.com + www.reirie.com) */
  certificate: acm.ICertificate;
  /** EC2 の Elastic IP (Ec2Stack.elasticIp.ref) */
  originIp: string;
}

export class SiteCdnStack extends Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: SiteCdnStackProps) {
    super(scope, id, props);
    const { config, domainName, hostedZone, certificate, originIp } = props;

    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    // ---- オリジン用の内部ホスト名 (CloudFront カスタムオリジンは IP 直指定不可) ----
    const originHostname = `origin-app.${domainName}`;
    new route53.ARecord(this, 'OriginAppARecord', {
      zone: hostedZone,
      recordName: originHostname,
      target: route53.RecordTarget.fromIpAddresses(originIp),
      comment: 'CloudFront カスタムオリジン用 (EC2 EIP への内部A レコード)',
    });

    // ---- Origin Request Policy: Host ヘッダーはオリジン向けに CloudFront が管理、
    //      その他の viewer ヘッダー (Cookie, Authorization 等) は全転送 ----
    // NextAuth のセッション判定に Cookie が必須のため、
    // キャッシュを無効化した上で全ヘッダー/Cookie/クエリを転送する。
    const originRequestPolicy = cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER;

    // 静的アセット (_next/static) はキャッシュ有効、それ以外はキャッシュ無効
    // (Next.js App Router のサーバーコンポーネント/認証ページを誤ってキャッシュしないため)
    const noCachePolicy = cloudfront.CachePolicy.CACHING_DISABLED;
    const staticCachePolicy = cloudfront.CachePolicy.CACHING_OPTIMIZED;

    const httpOrigin = new origins.HttpOrigin(originHostname, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      // オリジン (nginx) は Cloudflare Origin CA 証明書ではなく、CloudFront が
      // 直接検証できる証明書が理想だが、まずは自己署名/未検証でも通信自体は
      // 継続させたいため originSslProtocols のみ明示 (証明書検証は下記 originShield 等では扱わない)。
      originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
    });

    // ---- CloudFront Function: 元の Host ヘッダーを X-Forwarded-Host にコピー ----
    // CloudFront はオリジンへの Host ヘッダーを originHostname (内部名) に
    // 書き換えるため、reirie.com / www.reirie.com のどちらでアクセスされたかが
    // オリジン側 (nginx / Next.js) から失われる。viewer-request の時点で
    // 元の Host を別ヘッダーに保存し、オリジンまで転送する。
    const forwardHostFunction = new cloudfront.Function(this, 'ForwardHostFunction', {
      functionName: prefix(config, 'forward-host').replace(/-/g, '_'),
      comment: 'Copy the original Host header into X-Forwarded-Host before it is rewritten for the origin',
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var host = request.headers.host && request.headers.host.value;
  if (host) {
    request.headers['x-forwarded-host'] = { value: host };
  }
  return request;
}
`),
    });

    this.distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: prefix(config, 'site-cdn'),
      domainNames: [domainName, `www.${domainName}`],
      certificate,
      priceClass: cloudfront.PriceClass[config.cloudfrontPriceClass],
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: httpOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: noCachePolicy,
        originRequestPolicy,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
        functionAssociations: [
          {
            function: forwardHostFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        '/_next/static/*': {
          origin: httpOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: staticCachePolicy,
          originRequestPolicy,
          compress: true,
          functionAssociations: [
            {
              function: forwardHostFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
      },
    });

    // ---- Route 53: reirie.com / www.reirie.com → CloudFront (ALIAS) ----
    new route53.ARecord(this, 'ApexAliasRecord', {
      zone: hostedZone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
    });
    new route53.ARecord(this, 'WwwAliasRecord', {
      zone: hostedZone,
      recordName: `www.${domainName}`,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
    });

    // ---- Outputs ----
    new CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      exportName: prefix(config, 'site-cdn-id'),
    });
    new CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      exportName: prefix(config, 'site-cdn-domain'),
    });
    new CfnOutput(this, 'OriginHostname', {
      value: originHostname,
      description: 'CloudFront が接続する EC2 側の内部ホスト名 (Cloudflare Origin CA 証明書等はこの名前に対して発行しても良い)',
      exportName: prefix(config, 'origin-hostname'),
    });

    void Duration;
  }
}
