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
import { HLS_OUTPUT_PREFIX } from './storage-stack';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

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

  /**
   * MediaConvert 実行ロール (StorageStack が作成)。
   * EC2 上のアプリが CreateJob 時にこのロールを渡すため、
   * iam:PassRole をこのロール ARN に限定して許可する。
   */
  mediaConvertRole: iam.IRole;

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
      mediaConvertRole,
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
    // cron secret の自動生成 (user-data.sh)。
    // エンコード完了通知 Lambda と共有するシークレットが未登録のとき、
    // インスタンス側で生成して SSM に保存できるようにする。
    // 誤って他のパラメータを書き換えないよう cron/* に限定する。
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PutCronSecret',
        actions: ['ssm:PutParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${config.appName}/${config.envName}/cron/*`,
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
    // MediaConvert に渡す role を passRole 可能にする。
    // ワイルドカードではなく StorageStack が実際に作成したロール ARN に限定する
    // (存在しないロール名パターンを許可していても CreateJob は通らない)。
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [mediaConvertRole.roleArn],
        conditions: {
          StringEquals: { 'iam:PassedToService': 'mediaconvert.amazonaws.com' },
        },
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
      userDataScript = `set -euo pipefail
dnf -y update
dnf -y install git tar gzip jq postgresql15
# 詳細は deploy/user-data.sh を参照
`;
    }
    // CRLF 防護: Windows でクローンされたリポジトリでも安全に動作するように
    // 改行コードを LF に正規化 + 先頭の "#!" shebang を除去 (CDK が自動付与するため)
    userDataScript = userDataScript
      .replace(/\r\n/g, '\n')
      .replace(/^#!\s*\/[^\n]*\n/, '');
    // =================================================================
    // プレースホルダの解決方針
    // -----------------------------------------------------------------
    // 値には 2 種類ある。
    //   (a) synth 時に確定する定数 (appName / region / バケット名の一部 等)
    //   (b) deploy 時に CloudFormation が解決する **トークン**
    //       (dbSecret.secretArn, mediaConvertRole.roleArn = Fn::ImportValue 等)
    //
    // 後述の gzip 圧縮はスクリプト本文を synth 時にバイト列へ固めてしまうため、
    // (b) を本文に直接埋め込むと "${Token[TOKEN.123]}" という文字列が
    // そのまま焼き込まれ、実機で ARN が空になる (=エンコード不能に戻る)。
    //
    // そこで本文側のプレースホルダは **シェル変数参照** に置換し、
    // 実際の値は圧縮しないラッパー側で export する。
    // ラッパーは通常の UserData として CFn に渡るのでトークンが正しく解決される。
    // =================================================================
    const tokenVars: Record<string, string> = {
      APP_NAME: config.appName,
      ENV_NAME: config.envName,
      AWS_REGION: config.region,
      DB_HOST: props.dbHost,
      DB_PORT: props.dbPort,
      DB_NAME: props.dbName,
      DB_SECRET_ARN: dbSecret.secretArn,
      VIDEO_BUCKET: videoBucket.bucketName,
      ASSET_BUCKET: assetBucket.bucketName,
      MEDIA_OUTPUT_BUCKET: mediaOutputBucket.bucketName,
      // MediaConvert: ロール ARN と HLS 出力プレフィックスを .env.production へ注入。
      // これが無いと isMediaConvertConfigured() が false になり、
      // 管理画面が「MediaConvert が未設定です」のままエンコードできない。
      MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
      MEDIACONVERT_OUTPUT_PREFIX: HLS_OUTPUT_PREFIX,
      APP_REPO_URL: config.appRepoUrl ?? '',
      APP_BRANCH: config.appBranch,
    };

    // 本文: __FOO__ → ${FOO} (ラッパーが export した値を参照する)
    for (const key of Object.keys(tokenVars)) {
      userDataScript = userDataScript.replace(
        new RegExp(`__${key}__`, 'g'),
        `\${${key}}`,
      );
    }

    // 置換漏れ (タイポや新規追加のプレースホルダ) を synth 時に検出する
    const leftover = userDataScript.match(/__[A-Z0-9_]+__/g);
    if (leftover) {
      throw new Error(
        `deploy/user-data.sh に未置換のプレースホルダがあります: ${[...new Set(leftover)].join(', ')}`,
      );
    }

    // =================================================================
    // UserData の 16KB 制限対策 (gzip + base64 の自己解凍ラッパー)
    // -----------------------------------------------------------------
    // EC2 の UserData は **base64 デコード後で 16384 バイト** が上限。
    // user-data.sh は日本語コメントが多く (UTF-8 で 1 文字 3 バイト)、
    // 素のまま渡すと 20KB を超えて
    //   "User data is limited to 16384 bytes" で CREATE_FAILED になる。
    //
    // cloud-init は gzip されたペイロードを自動展開してくれるが、
    // CDK の UserData.forLinux() は必ず先頭に shebang を付けて
    // テキストとして流すため、その経路には乗せられない。
    // そこで「小さなシェルスクリプトの中に本体を gzip+base64 で埋め込み、
    // 実行時に自分で展開して bash に渡す」自己解凍方式を使う。
    //
    // 効果: 約 20.8KB → 約 9.5KB (制限の 6 割以下)。
    // 展開後のスクリプトは /var/lib/cloud/instance/payload.sh に置き、
    // ログを /var/log/user-data.log に集約する挙動は従来どおり。
    // =================================================================
    const payloadB64 = zlib
      .gzipSync(Buffer.from(userDataScript, 'utf8'), { level: 9 })
      .toString('base64');

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euo pipefail',
      // --- (b) トークンを含む値はここで export する ---
      // この部分は圧縮せずそのまま CFn に渡るため、
      // Fn::ImportValue / Fn::GetAtt が deploy 時に正しく解決される。
      ...Object.entries(tokenVars).map(([k, v]) => `export ${k}='${v}'`),
      // --- 本体を展開して実行 ---
      'PAYLOAD=/var/lib/cloud/instance/payload.sh',
      `echo '${payloadB64}' | base64 -d | gunzip > "$PAYLOAD"`,
      'chmod 700 "$PAYLOAD"',
      'exec bash "$PAYLOAD"',
    );

    // 16KB 制限に収まっているかを synth 時に検証する。
    // ここで落としておかないと deploy 実行時まで気付けない。
    const renderedBytes = Buffer.byteLength(userData.render(), 'utf8');
    const USER_DATA_LIMIT = 16384;
    if (renderedBytes > USER_DATA_LIMIT) {
      throw new Error(
        `UserData が ${renderedBytes} バイトで EC2 の上限 ${USER_DATA_LIMIT} バイトを超えています。` +
          ' deploy/user-data.sh を削るか、S3 に置いて取得する方式へ切り替えてください。',
      );
    }

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
      // UserData の内容が変わったら必ずインスタンスを置き換える。
      // これが false (デフォルト) だと CFn は UserData プロパティだけの差分では
      // 何もせず UPDATE_COMPLETE になり、修正したスクリプトが既存インスタンスに
      // 反映されない (実機 i-05e35460834d4ef18 で発生)。
      userDataCausesReplacement: true,
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
