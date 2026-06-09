/**
 * Network Stack
 *  - VPC (2 AZ, public + private + isolated subnets)
 *  - Security Groups (EC2 / RDS / Lambda)
 *  - VPC Endpoints (S3 Gateway, SES Interface など)
 */
import { Stack, type StackProps, CfnOutput } from 'aws-cdk-lib';
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

    // VPC: 2 AZ / public + private + isolated
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: prefix(config, 'vpc'),
      ipAddresses: ec2.IpAddresses.cidr('10.10.0.0/16'),
      maxAzs: 2,
      natGateways: config.envName === 'prod' ? 2 : 1,
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
    // Cloudflare からのみ 80/443 を受ける想定 (実運用では CF の IP レンジを参照)
    // 開発・MVP では一旦 Anywhere
    this.ec2SecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP from Cloudflare (or anywhere in dev)',
    );
    this.ec2SecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS from Cloudflare (or anywhere in dev)',
    );

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
