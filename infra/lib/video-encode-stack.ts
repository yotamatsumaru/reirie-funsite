/**
 * Video Encode Stack (MediaConvert 完了通知ブリッジ)
 *
 *  - Lambda Function (Node.js 20) : functions/video-job-complete
 *  - EventBridge Rule             : MediaConvert Job State Change (COMPLETE / ERROR)
 *  - SQS DLQ                      : Web API 一時障害時の取りこぼし回収
 *
 * ## なぜこのスタックが必要か (重要)
 * MediaConvert は **ジョブ完了を push 通知しない**。
 * EventBridge の "MediaConvert Job State Change" を拾って Web API
 * (`POST /api/admin/videos/job-complete`) を叩くことで初めて
 * Video が READY になる。
 *
 * この通知経路は従来 `functions/video-job-complete/README.md` の
 * **手動 aws CLI 手順**しか無く、CDK に定義が存在しなかった。
 * そのため `cdk deploy` しても永久にデプロイされず、
 * アップロードした動画が「エンコード中」のまま固まる原因になっていた。
 * 本スタックはその手順をコード化し、`cdk deploy` で再現可能にする。
 *
 * ## VPC に入れない理由
 * この Lambda は RDS を触らず、パブリックな Web API を fetch するだけ。
 * VPC 内に置くと NAT Gateway 経由の egress が必要になり、コストと
 * 障害点が増えるため、あえて VPC 外に置く。
 *
 * ## 冪等性
 * Web API 側は「同じ jobId で二度 COMPLETE が来ても READY のまま」
 * (publishedAt は既存値を維持) なので、EventBridge のリトライや
 * 手動の状態確認と併用しても安全。
 */
import {
  Stack,
  type StackProps,
  CfnOutput,
  Duration,
  RemovalPolicy,
} from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';
import * as path from 'path';
import * as fs from 'fs';

export interface VideoEncodeStackProps extends StackProps {
  config: AppConfig;
  /**
   * Web アプリのベース URL (例 https://reirie.com)。
   * 未指定なら config.domainName から組み立てる。
   */
  webAppBaseUrl?: string;
}

export class VideoEncodeStack extends Stack {
  public readonly jobCompleteFn?: lambda.Function;
  public readonly rule?: events.Rule;

  constructor(scope: Construct, id: string, props: VideoEncodeStackProps) {
    super(scope, id, props);
    const { config } = props;

    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    // ---- Lambda バンドルの存在確認 ----
    // ZIP は `pnpm --filter @idol/video-job-complete build` で生成する前提。
    // 未ビルドのまま synth すると分かりにくいエラーになるため、
    // ここで明示的に案内する (CI では build を先に回す)。
    const codePath = path.resolve(__dirname, '../../functions/video-job-complete/dist');
    const bundleExists = fs.existsSync(path.join(codePath, 'index.js'));
    if (!bundleExists) {
      // synth を止めてしまうと他スタックの deploy も巻き込むため、
      // ここでは警告のみ出して当スタックのリソース作成をスキップする。
      new CfnOutput(this, 'VideoJobCompleteSkipped', {
        value:
          'functions/video-job-complete/dist/index.js が無いためスキップしました。' +
          'pnpm --filter @idol/video-job-complete build を実行してから再デプロイしてください。',
        description: 'Video job-complete Lambda was NOT deployed',
      });
      return;
    }

    // ---- Web アプリのベース URL ----
    const webAppBaseUrl =
      props.webAppBaseUrl ??
      (config.domainName ? `https://${config.domainName}` : undefined);
    if (!webAppBaseUrl) {
      throw new Error(
        'VideoEncodeStack: webAppBaseUrl も config.domainName も未設定です。' +
          'Lambda の転送先 (WEB_APP_BASE_URL) を決められません。',
      );
    }

    // ---- CRON_SECRET は SecureString の「名前だけ」を渡し、Lambda 内で取得 ----
    // CFn は Lambda 環境変数に SecureString の値を直接埋め込めないため。
    const cronSecretParamName = `/${config.appName}/${config.envName}/app/cron-secret`;
    const cronSecretParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      'CronSecretParam',
      { parameterName: cronSecretParamName },
    );

    // ---- DLQ (Web API 側の一時障害で取りこぼさないため) ----
    const dlq = new sqs.Queue(this, 'VideoJobCompleteDlq', {
      queueName: prefix(config, 'video-job-complete-dlq'),
      retentionPeriod: Duration.days(14),
      removalPolicy: config.destroyOnRemove
        ? RemovalPolicy.DESTROY
        : RemovalPolicy.RETAIN,
      enforceSSL: true,
    });

    // ---- 実行ロール (CloudWatch Logs + SSM 読み取りのみ) ----
    const fnRole = new iam.Role(this, 'VideoJobCompleteRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for MediaConvert job-complete bridge Lambda',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
    });
    cronSecretParam.grantRead(fnRole);

    const logGroup = new logs.LogGroup(this, 'VideoJobCompleteLogGroup', {
      logGroupName: `/aws/lambda/${prefix(config, 'video-job-complete')}`,
      retention:
        config.envName === 'prod'
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: config.destroyOnRemove
        ? RemovalPolicy.DESTROY
        : RemovalPolicy.RETAIN,
    });

    // ---- Lambda 本体 ----
    this.jobCompleteFn = new lambda.Function(this, 'VideoJobCompleteFn', {
      functionName: prefix(config, 'video-job-complete'),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(codePath),
      role: fnRole,
      // fetch 1 回で終わるので小さく短く
      timeout: Duration.seconds(20),
      memorySize: 256,
      logGroup,
      environment: {
        WEB_APP_BASE_URL: webAppBaseUrl,
        // SecureString は名前だけ渡し、Lambda 内で SDK 取得する
        CRON_SECRET_PARAM: cronSecretParamName,
        JOB_COMPLETE_PATH: '/api/admin/videos/job-complete',
        REQUEST_TIMEOUT_MS: '8000',
      },
      // 失敗時は EventBridge 側でリトライ → 最終的に DLQ へ
      deadLetterQueue: dlq,
      retryAttempts: 2,
      tracing: lambda.Tracing.ACTIVE,
    });

    // ---- EventBridge ルール ----
    // COMPLETE / ERROR のみ拾う (中間状態は Lambda 側でも二重に無視する)
    this.rule = new events.Rule(this, 'MediaConvertJobStateChangeRule', {
      ruleName: prefix(config, 'mediaconvert-job-state-change'),
      description:
        'MediaConvert job COMPLETE/ERROR -> notify web app to flip Video status',
      eventPattern: {
        source: ['aws.mediaconvert'],
        detailType: ['MediaConvert Job State Change'],
        detail: { status: ['COMPLETE', 'ERROR'] },
      },
    });
    this.rule.addTarget(
      new targets.LambdaFunction(this.jobCompleteFn, { retryAttempts: 2 }),
    );

    // ---- Outputs ----
    new CfnOutput(this, 'VideoJobCompleteFnName', {
      value: this.jobCompleteFn.functionName,
      description: 'MediaConvert job-complete bridge Lambda',
    });
    new CfnOutput(this, 'VideoJobCompleteRuleName', {
      value: this.rule.ruleName,
      description: 'EventBridge rule for MediaConvert job state change',
    });
    new CfnOutput(this, 'VideoJobCompleteDlqUrl', {
      value: dlq.queueUrl,
      description: 'DLQ for failed job-complete notifications',
    });
  }
}
