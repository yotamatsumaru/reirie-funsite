/**
 * EC2 Stack (Next.js アプリサーバ)
 *  - Amazon Linux 2023 EC2 インスタンス
 *  - Elastic IP で固定IP化 (Cloudflare DNS で A レコード指定)
 *  - IAM Role: Secrets Manager / SSM / S3 / SES / CloudFront / IVS / MediaConvert アクセス
 *  - User Data: nvm + Node 20.20.0 + pnpm + PM2 をプロビジョニング
 *  - SSM Session Manager 経由で SSH 不要にアクセス可能
 */
import {
  Stack,
  type StackProps,
  CfnOutput,
  Tags,
  Duration,
} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';
import * as fs from 'fs';
import * as path from 'path';

export interface Ec2StackProps extends StackProps {
  config: AppConfig;
  vpc: ec2.IVpc;
  ec2SecurityGroup: ec2.ISecurityGroup;

  dbSecret: secretsmanager.ISecret;
  dbHost: string;
  dbPort: string;
  dbName: string;

  videoBucket: s3.IBucket;
  assetBucket: s3.IBucket;
  mediaOutputBucket: s3.IBucket;

  sesSendingPolicy: iam.IManagedPolicy;
}

export class Ec2Stack extends Stack {
  public readonly instance: ec2.Instance;
  public readonly elasticIp: ec2.CfnEIP;

  constructor(scope: Construct, id: string, props: Ec2StackProps) {
    super(scope, id, props);
    const {
      config,
      vpc,
      ec2SecurityGroup,
      dbSecret,
      videoBucket,
      assetBucket,
      mediaOutputBucket,
      sesSendingPolicy,
    } = props;

    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    // ---- IAM Role ----
    const role = new iam.Role(this, 'Ec2Role', {
      roleName: prefix(config, 'ec2-role'),
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        sesSendingPolicy,
      ],
    });
    dbSecret.grantRead(role);

    // S3 アクセス
    videoBucket.grantReadWrite(role);
    assetBucket.grantReadWrite(role);
    mediaOutputBucket.grantRead(role);

    // SSM Parameter Store (Stripe / Lawson 等の secrets)
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${config.appName}/${config.envName}/*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` },
        },
      }),
    );

    // CloudFront signed URL 用 (KMS 不要 - private key は SSM SecureString 経由)
    // IVS PrivateChannel 関連
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ivs:GetChannel',
          'ivs:GetStream',
          'ivs:ListChannels',
          'ivs:ListStreams',
          'ivs:CreateChannel',
          'ivs:UpdateChannel',
        ],
        resources: ['*'],
      }),
    );

    // MediaConvert (動画変換ジョブ起動)
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'mediaconvert:CreateJob',
          'mediaconvert:GetJob',
          'mediaconvert:ListJobs',
          'mediaconvert:DescribeEndpoints',
        ],
        resources: ['*'],
      }),
    );
    // MediaConvert に渡す role を passRole 可能にする
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [`arn:aws:iam::${this.account}:role/${prefix(config, 'mediaconvert-*')}`],
      }),
    );

    // ---- User Data ----
    // deploy/user-data.sh を読み込み + プレースホルダ置換
    const userDataPath = path.resolve(__dirname, '../../deploy/user-data.sh');
    let userDataScript: string;
    if (fs.existsSync(userDataPath)) {
      userDataScript = fs.readFileSync(userDataPath, 'utf8');
    } else {
      // フォールバック (deploy/user-data.sh が未作成の場合の最低限スクリプト)
      userDataScript = `#!/bin/bash
set -euo pipefail
dnf -y update
dnf -y install git tar gzip jq postgresql15
# 詳細は deploy/user-data.sh を参照
`;
    }
    // 環境変数の埋め込み
    userDataScript = userDataScript
      .replace(/__APP_NAME__/g, config.appName)
      .replace(/__ENV_NAME__/g, config.envName)
      .replace(/__AWS_REGION__/g, config.region)
      .replace(/__DB_HOST__/g, props.dbHost)
      .replace(/__DB_PORT__/g, props.dbPort)
      .replace(/__DB_NAME__/g, props.dbName)
      .replace(/__DB_SECRET_ARN__/g, dbSecret.secretArn)
      .replace(/__VIDEO_BUCKET__/g, videoBucket.bucketName)
      .replace(/__ASSET_BUCKET__/g, assetBucket.bucketName)
      .replace(/__MEDIA_OUTPUT_BUCKET__/g, mediaOutputBucket.bucketName)
      .replace(/__APP_REPO_URL__/g, config.appRepoUrl ?? '')
      .replace(/__APP_BRANCH__/g, config.appBranch);

    const userData = ec2.UserData.forLinux();
    userData.addCommands(userDataScript);

    // ---- インスタンスタイプ ----
    const [, size] = config.ec2InstanceType.split('.');
    const instanceClass = ec2.InstanceClass.T3;
    const instanceSize =
      size === 'medium'
        ? ec2.InstanceSize.MEDIUM
        : size === 'large'
          ? ec2.InstanceSize.LARGE
          : ec2.InstanceSize.SMALL;

    // ---- AMI: Amazon Linux 2023 ----
    const ami = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
    });

    // ---- EC2 Instance ----
    this.instance = new ec2.Instance(this, 'AppInstance', {
      instanceName: prefix(config, 'app'),
      instanceType: ec2.InstanceType.of(instanceClass, instanceSize),
      machineImage: ami,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: ec2SecurityGroup,
      role,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
      requireImdsv2: true,
      detailedMonitoring: config.envName === 'prod',
    });

    // ---- Elastic IP (固定IP) ----
    this.elasticIp = new ec2.CfnEIP(this, 'AppEip', {
      domain: 'vpc',
      instanceId: this.instance.instanceId,
      tags: [
        { key: 'Name', value: prefix(config, 'app-eip') },
        ...Object.entries(commonTags(config)).map(([k, v]) => ({ key: k, value: v })),
      ],
    });

    Tags.of(this.instance).add('Name', prefix(config, 'app'));

    // ---- Outputs ----
    new CfnOutput(this, 'InstanceId', {
      value: this.instance.instanceId,
      exportName: prefix(config, 'instance-id'),
    });
    new CfnOutput(this, 'PublicIp', {
      value: this.elasticIp.ref,
      description: 'Cloudflare DNS の A レコードに設定するこの IP',
      exportName: prefix(config, 'public-ip'),
    });
    new CfnOutput(this, 'SsmSessionCommand', {
      value: `aws ssm start-session --target ${this.instance.instanceId} --region ${this.region}`,
      description: 'SSM Session Manager で接続するコマンド',
    });

    // 抑制: Duration が未使用 (将来の auto-scaling 対応で使う想定)
    void Duration;
  }
}
