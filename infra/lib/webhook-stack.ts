/**
 * Webhook Stack (Stripe Webhook Lambda)
 *  - Lambda Function (Node.js 20, VPC 内, RDS アクセス)
 *  - Function URL (パブリック / 認証なし — Stripe-Signature で検証)
 *  - SSM Parameter から DB / Stripe シークレットを参照
 *
 *  EC2 (Next.js) から独立しており、EC2 障害時も Webhook を受け続けられる。
 */
import {
  Stack,
  type StackProps,
  CfnOutput,
  Duration,
  RemovalPolicy,
} from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';
import * as path from 'path';

export interface WebhookStackProps extends StackProps {
  config: AppConfig;
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  dbSecret: secretsmanager.ISecret;
  dbHost: string;
  dbPort: string;
  dbName: string;
}

export class WebhookStack extends Stack {
  public readonly lambdaFn: lambda.Function;
  public readonly functionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: WebhookStackProps) {
    super(scope, id, props);
    const {
      config,
      vpc,
      lambdaSecurityGroup,
      dbSecret,
      dbHost,
      dbPort,
      dbName,
    } = props;

    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    // ---- Stripe シークレットを SSM SecureString 経由で参照 ----
    // 値そのものは CDK 外で aws ssm put-parameter 済みであることが前提
    const stripeSecretParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      'StripeSecretKeyParam',
      { parameterName: `/${config.appName}/${config.envName}/stripe/secret-key` },
    );
    const stripeWebhookSecretParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      'StripeWebhookSecretParam',
      { parameterName: `/${config.appName}/${config.envName}/stripe/webhook-secret` },
    );
    // Price ID 群 (SecureString ではなく String で管理)
    const priceParams: Record<string, ssm.IStringParameter> = {
      STRIPE_PRICE_STANDARD_MONTHLY: ssm.StringParameter.fromStringParameterName(
        this,
        'PriceSm',
        `/${config.appName}/${config.envName}/stripe/price/standard-monthly`,
      ),
      STRIPE_PRICE_STANDARD_YEARLY: ssm.StringParameter.fromStringParameterName(
        this,
        'PriceSy',
        `/${config.appName}/${config.envName}/stripe/price/standard-yearly`,
      ),
      STRIPE_PRICE_PREMIUM_MONTHLY: ssm.StringParameter.fromStringParameterName(
        this,
        'PricePm',
        `/${config.appName}/${config.envName}/stripe/price/premium-monthly`,
      ),
      STRIPE_PRICE_PREMIUM_YEARLY: ssm.StringParameter.fromStringParameterName(
        this,
        'PricePy',
        `/${config.appName}/${config.envName}/stripe/price/premium-yearly`,
      ),
    };

    // ---- Lambda Role ----
    const lambdaRole = new iam.Role(this, 'StripeWebhookRole', {
      roleName: prefix(config, 'stripe-webhook-role'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaVPCAccessExecutionRole',
        ),
      ],
    });
    dbSecret.grantRead(lambdaRole);
    stripeSecretParam.grantRead(lambdaRole);
    stripeWebhookSecretParam.grantRead(lambdaRole);

    // ---- Log Group ----
    const logGroup = new logs.LogGroup(this, 'StripeWebhookLogGroup', {
      logGroupName: `/aws/lambda/${prefix(config, 'stripe-webhook')}`,
      retention:
        config.envName === 'prod' ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: config.destroyOnRemove ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    // ---- DB 接続文字列を Lambda 環境変数に直接展開はせず、
    //      Lambda 側で Secrets Manager から取得する方式が安全だが、
    //      今回は MVP として「DATABASE_URL を CDK で組み立て」する簡易方式 ----
    // 注: 本番では Lambda 起動時に Secrets Manager から動的取得 + キャッシュを推奨
    const dbUrlBase = `postgresql://${dbSecret
      .secretValueFromJson('username')
      .unsafeUnwrap()}:${dbSecret
      .secretValueFromJson('password')
      .unsafeUnwrap()}@${dbHost}:${dbPort}/${dbName}?schema=public&sslmode=require`;

    // ---- Lambda Function ----
    // ZIP は functions/stripe-webhook/dist にビルド済み前提
    const codePath = path.resolve(__dirname, '../../functions/stripe-webhook/dist');
    this.lambdaFn = new lambda.Function(this, 'StripeWebhookFn', {
      functionName: prefix(config, 'stripe-webhook'),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(codePath),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
      timeout: Duration.seconds(15),
      memorySize: 512,
      logGroup,
      environment: {
        NODE_ENV: config.envName === 'prod' ? 'production' : config.envName,
        APP_NAME: config.appName,
        ENV_NAME: config.envName,
        DATABASE_URL: dbUrlBase,
        STRIPE_SECRET_KEY: stripeSecretParam.stringValue,
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecretParam.stringValue,
        STRIPE_PRICE_STANDARD_MONTHLY:
          priceParams.STRIPE_PRICE_STANDARD_MONTHLY!.stringValue,
        STRIPE_PRICE_STANDARD_YEARLY:
          priceParams.STRIPE_PRICE_STANDARD_YEARLY!.stringValue,
        STRIPE_PRICE_PREMIUM_MONTHLY:
          priceParams.STRIPE_PRICE_PREMIUM_MONTHLY!.stringValue,
        STRIPE_PRICE_PREMIUM_YEARLY:
          priceParams.STRIPE_PRICE_PREMIUM_YEARLY!.stringValue,
      },
      reservedConcurrentExecutions: config.envName === 'prod' ? 50 : 5,
      tracing: lambda.Tracing.ACTIVE,
      retryAttempts: 0, // Stripe 側で自動リトライするので Lambda 側は不要
    });

    // ---- Function URL (認証なし - Stripe 署名で検証) ----
    this.functionUrl = this.lambdaFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['stripe-signature', 'content-type'],
        maxAge: Duration.seconds(0),
      },
      invokeMode: lambda.InvokeMode.BUFFERED,
    });

    // ---- Outputs ----
    new CfnOutput(this, 'StripeWebhookFunctionUrl', {
      value: this.functionUrl.url,
      description: 'Stripe ダッシュボードに登録する Webhook エンドポイント URL',
      exportName: prefix(config, 'stripe-webhook-url'),
    });
    new CfnOutput(this, 'StripeWebhookFunctionArn', {
      value: this.lambdaFn.functionArn,
      exportName: prefix(config, 'stripe-webhook-arn'),
    });
  }
}
