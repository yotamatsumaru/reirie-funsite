/**
 * DNS Stack
 *  - Route 53 Public Hosted Zone (reirie.com)
 *  - ACM 証明書 (us-east-1固定, DNS検証) — CloudFront で使うため必ず us-east-1
 *
 * 運用:
 *  - お名前.com 等の登録会社では「ドメインの所有・更新」のみ継続し、
 *    DNS 管理 (ネームサーバー) は本スタックが作る HostedZone に委譲する。
 *  - このスタックの Output `NameServers` を、登録会社側の
 *    ネームサーバー設定に登録する (手動作業、後述の docs/DEPLOYMENT.md 参照)。
 *  - CloudFront が使う証明書は必ず us-east-1 リージョンでなければならないため、
 *    このスタック自体を us-east-1 env で作成する (bin/app.ts で明示的に指定)。
 */
import { Stack, type StackProps, CfnOutput, Duration, Fn } from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';

export interface DnsStackProps extends StackProps {
  config: AppConfig;
  /** 対象ドメイン (例: reirie.com) */
  domainName: string;
}

export class DnsStack extends Stack {
  public readonly hostedZone: route53.PublicHostedZone;
  /** reirie.com + www.reirie.com をカバーする ACM 証明書 (us-east-1, CloudFront 用) */
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);
    const { config, domainName } = props;

    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    this.hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
      zoneName: domainName,
      comment: prefix(config, 'hosted-zone'),
    });

    // CloudFront にアタッチする証明書は必ず us-east-1 である必要がある。
    // このスタック自体を us-east-1 にデプロイする前提 (bin/app.ts 側で env.region を固定)。
    this.certificate = new acm.Certificate(this, 'SiteCertificate', {
      domainName,
      subjectAlternativeNames: [`www.${domainName}`],
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    // ---- Outputs ----
    new CfnOutput(this, 'HostedZoneId', {
      value: this.hostedZone.hostedZoneId,
      exportName: prefix(config, 'hosted-zone-id'),
    });
    new CfnOutput(this, 'NameServers', {
      // hostedZoneNameServers はトークン化されたリストのため、JS の Array#join は使えない。
      // CloudFormation の Fn::Join として合成する必要がある。
      value: Fn.join(', ', this.hostedZone.hostedZoneNameServers!),
      description:
        'お名前.com のネームサーバー設定にこの値 (カンマ区切り4件) を登録してください',
      exportName: prefix(config, 'name-servers'),
    });
    new CfnOutput(this, 'CertificateArn', {
      value: this.certificate.certificateArn,
      exportName: prefix(config, 'certificate-arn'),
    });

    // 抑制: Duration が未使用 (将来の TTL 調整用)
    void Duration;
  }
}
