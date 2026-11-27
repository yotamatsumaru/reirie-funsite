/**
 * Network Stack
 *  - VPC (2 AZ, public + private + isolated subnets)
 *  - Security Groups (EC2 / RDS / Lambda)
 *  - VPC Endpoints (S3 Gateway, SES Interface など)
 */
import { Aspects, Stack, type StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';

export interface NetworkStackProps extends StackProps {
  config: AppConfig;
}

export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc;
  public readonly ec2SecurityGroup: ec2.SecurityGroup;
  public readonly rdsSecurityGroup: ec2.SecurityGroup;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { config } = props;

    // 共通タグ
    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    // ---- private サブネットの外向き出口 (NAT) ----
    // private サブネットにいるのは Stripe Webhook Lambda だけで、外へ出る用途は
    // Stripe API (subscriptions/customers.retrieve) と SSM (シークレット取得) のみ。
    // EC2 は public サブネット + EIP、RDS は isolated なので NAT を使わない。
    // NAT ゲートウェイは時間課金だけで月 $46 (ファンクラブの AWS 費用の約 4 割) かかるため、
    // dev/stg (= 現在の本番 reirie.com) は t4g.nano の NAT インスタンス (月 $5 前後) にする。
    const natProvider =
      config.natMode === 'instance'
        ? ec2.NatProvider.instanceV2({
            instanceType: new ec2.InstanceType(config.natInstanceType),
            // public サブネットは mapPublicIpOnLaunch=false なので明示的に付与する
            // (NAT ゲートウェイの EIP と入れ替わるだけなので IPv4 の個数・料金は変わらない)
            associatePublicIpAddress: true,
            // 既定の「全 IPv4 から全ポート受信」は開けすぎ。受信は下で Lambda SG だけに絞る。
            defaultAllowedTraffic: ec2.NatTrafficDirection.OUTBOUND_ONLY,
            // バーストクレジット超過の追加課金を避ける (iptables の転送はほぼ CPU を使わない)
            creditSpecification: ec2.CpuCredits.STANDARD,
            userData: natInstanceUserData(),
          })
        : undefined;

    // VPC: 2 AZ / public + private + isolated
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: prefix(config, 'vpc'),
      ipAddresses: ec2.IpAddresses.cidr('10.10.0.0/16'),
      maxAzs: 2,
      natGateways: config.natMode === 'instance' ? 1 : config.envName === 'prod' ? 2 : 1,
      ...(natProvider ? { natGatewayProvider: natProvider } : {}),
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: false,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // S3 Gateway Endpoint (private/isolated → S3 への通信を NAT 経由せず)
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // ---- Security Groups ----

    // EC2 (Next.js アプリサーバ)
    this.ec2SecurityGroup = new ec2.SecurityGroup(this, 'Ec2Sg', {
      vpc: this.vpc,
      securityGroupName: prefix(config, 'ec2-sg'),
      description: 'Idol fansite EC2 (Next.js + PM2)',
      allowAllOutbound: true,
    });
    // 80: nginx は https へのリダイレクトと Let's Encrypt (HTTP-01) の応答しか返さないので
    //     全開放のままにする (証明書更新が止まると 2026-10-10 のような 502 障害になる)。
    this.ec2SecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP (redirect to HTTPS + ACME HTTP-01)',
    );
    // 443: context cloudFrontPrefixListId を指定した場合は CloudFront からのみ許可する。
    //      オリジン IP に直接アクセスされると WAF / レート制限を迂回されるため。
    //      (未指定なら従来どおり全開放 — 既存環境の挙動を変えない)
    if (config.cloudFrontPrefixListId) {
      this.ec2SecurityGroup.addIngressRule(
        ec2.Peer.prefixList(config.cloudFrontPrefixListId),
        ec2.Port.tcp(443),
        'HTTPS from CloudFront origin-facing only (WAF bypass prevention)',
      );
    } else {
      this.ec2SecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(443),
        'HTTPS from anywhere (set cloudFrontPrefixListId to restrict)',
      );
    }

    // RDS (PostgreSQL 15)
    this.rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc: this.vpc,
      securityGroupName: prefix(config, 'rds-sg'),
      description: 'Idol fansite RDS (PostgreSQL 15)',
      allowAllOutbound: false,
    });
    // EC2 → RDS
    this.rdsSecurityGroup.addIngressRule(
      this.ec2SecurityGroup,
      ec2.Port.tcp(5432),
      'PostgreSQL from EC2',
    );

    // Lambda (Stripe Webhook)
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      securityGroupName: prefix(config, 'lambda-sg'),
      description: 'Idol fansite Stripe Webhook Lambda',
      allowAllOutbound: true,
    });
    // Lambda → RDS
    this.rdsSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'PostgreSQL from Stripe Webhook Lambda',
    );

    // Lambda → NAT インスタンス (HTTPS のみ)
    if (natProvider instanceof ec2.NatInstanceProviderV2) {
      natProvider.connections.allowFrom(
        this.lambdaSecurityGroup,
        ec2.Port.tcp(443),
        'HTTPS from Stripe Webhook Lambda (Stripe API / SSM)',
      );
      for (const natInstance of natProvider.gatewayInstances) {
        // AWS のハードウェア障害 (システムステータスチェック失敗) では同じ IP のまま自動復旧、
        // OS 側の異常 (インスタンスステータスチェック失敗) では自動再起動する。
        new cloudwatch.Alarm(natInstance, 'SystemStatusRecover', {
          alarmName: prefix(config, 'nat-instance-system-recover'),
          alarmDescription: 'NAT instance system status check failed -> auto recover',
          metric: new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'StatusCheckFailed_System',
            dimensionsMap: { InstanceId: natInstance.instanceId },
            statistic: 'Maximum',
            period: Duration.minutes(1),
          }),
          threshold: 1,
          evaluationPeriods: 2,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }).addAlarmAction(new cwActions.Ec2Action(cwActions.Ec2InstanceAction.RECOVER));
        new cloudwatch.Alarm(natInstance, 'InstanceStatusReboot', {
          alarmName: prefix(config, 'nat-instance-status-reboot'),
          alarmDescription: 'NAT instance status check failed -> auto reboot',
          metric: new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'StatusCheckFailed_Instance',
            dimensionsMap: { InstanceId: natInstance.instanceId },
            statistic: 'Maximum',
            period: Duration.minutes(1),
          }),
          threshold: 1,
          evaluationPeriods: 3,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        }).addAlarmAction(new cwActions.Ec2Action(cwActions.Ec2InstanceAction.REBOOT));
      }
      // NAT インスタンスもメタデータは IMDSv2 必須にする
      Aspects.of(this).add(new ec2.InstanceRequireImdsv2Aspect());
    }

    // ---- Outputs ----
    new CfnOutput(this, 'VpcId', { value: this.vpc.vpcId, exportName: prefix(config, 'vpc-id') });
    new CfnOutput(this, 'Ec2SgId', {
      value: this.ec2SecurityGroup.securityGroupId,
      exportName: prefix(config, 'ec2-sg-id'),
    });
    new CfnOutput(this, 'RdsSgId', {
      value: this.rdsSecurityGroup.securityGroupId,
      exportName: prefix(config, 'rds-sg-id'),
    });
  }
}

/**
 * NAT インスタンス (Amazon Linux 2023) の初期化。
 * CDK 既定のコマンドは `route` (net-tools) に依存するため、標準で入っている `ip` を使う。
 */
function natInstanceUserData(): ec2.UserData {
  const ud = ec2.UserData.forLinux();
  ud.addCommands(
    'set -eux',
    'dnf install -y iptables-services',
    'systemctl enable --now iptables',
    'echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/90-nat.conf',
    'sysctl -p /etc/sysctl.d/90-nat.conf',
    'IFACE=$(ip route show default | awk \'{print $5; exit}\')',
    'iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE',
    'iptables -F FORWARD',
    'service iptables save',
  );
  return ud;
}
