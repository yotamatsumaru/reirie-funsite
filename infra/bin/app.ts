#!/usr/bin/env node
/**
 * AWS CDK エントリポイント
 *  全スタックを束ねて依存関係を組む
 *
 *  デプロイ順序:
 *    1. NetworkStack
 *    2. DatabaseStack       (depends on Network)
 *    3. StorageStack        (independent)
 *    4. EmailStack          (independent)
 *    5. LiveStack           (depends on Storage)
 *    6. WebhookStack        (depends on Network, Database)
 *    7. Ec2Stack            (depends on Network, Database, Storage, Email)
 *    8. MonitoringStack     (depends on Ec2, Database, Webhook)
 */
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { loadConfig } from '../lib/config';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { StorageStack } from '../lib/storage-stack';
import { EmailStack } from '../lib/email-stack';
import { LiveStack } from '../lib/live-stack';
import { WebhookStack } from '../lib/webhook-stack';
import { Ec2Stack } from '../lib/ec2-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();
const config = loadConfig(app);

const env: cdk.Environment = {
  account: config.account ?? process.env.CDK_DEFAULT_ACCOUNT,
  region: config.region,
};

const stackPrefix = `${config.appName}-${config.envName}`;

// 1. Network
const network = new NetworkStack(app, `${stackPrefix}-network`, {
  env,
  config,
  description: 'VPC, subnets, security groups',
});

// 2. Database
const database = new DatabaseStack(app, `${stackPrefix}-database`, {
  env,
  config,
  vpc: network.vpc,
  rdsSecurityGroup: network.rdsSecurityGroup,
  description: 'RDS PostgreSQL 15',
});
database.addDependency(network);

// 3. Storage (S3 + CloudFront)
const cloudfrontPublicKeyPem = app.node.tryGetContext('cloudfrontPublicKeyPem') as
  | string
  | undefined;
const storage = new StorageStack(app, `${stackPrefix}-storage`, {
  env,
  config,
  cloudfrontPublicKeyPem,
  description: 'S3 buckets + CloudFront distributions',
});

// 4. Email (SES)
const sendingDomain = app.node.tryGetContext('sendingDomain') as string | undefined;
const email = new EmailStack(app, `${stackPrefix}-email`, {
  env,
  config,
  sendingDomain,
  description: 'SES configuration set + sending policy',
});

// 5. Live (IVS)
const ivsPlaybackPublicKeyPem = app.node.tryGetContext('ivsPlaybackPublicKeyPem') as
  | string
  | undefined;
const live = new LiveStack(app, `${stackPrefix}-live`, {
  env,
  config,
  recordingBucket: storage.mediaOutputBucket,
  playbackPublicKeyPem: ivsPlaybackPublicKeyPem,
  description: 'IVS Channel + Recording + Playback Key',
});
live.addDependency(storage);

// 6. Webhook (Stripe Webhook Lambda)
const webhook = new WebhookStack(app, `${stackPrefix}-webhook`, {
  env,
  config,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  dbSecret: database.dbSecret,
  dbHost: database.dbInstance.dbInstanceEndpointAddress,
  dbPort: database.dbInstance.dbInstanceEndpointPort,
  dbName: 'idol_fansite',
  description: 'Stripe Webhook Lambda + Function URL',
});
webhook.addDependency(network);
webhook.addDependency(database);

// 7. EC2 (Next.js アプリ)
const ec2Stack = new Ec2Stack(app, `${stackPrefix}-ec2`, {
  env,
  config,
  vpc: network.vpc,
  ec2SecurityGroup: network.ec2SecurityGroup,
  dbSecret: database.dbSecret,
  dbHost: database.dbInstance.dbInstanceEndpointAddress,
  dbPort: database.dbInstance.dbInstanceEndpointPort,
  dbName: 'idol_fansite',
  videoBucket: storage.videoBucket,
  assetBucket: storage.assetBucket,
  mediaOutputBucket: storage.mediaOutputBucket,
  sesSendingPolicy: email.sendingPolicy,
  description: 'EC2 instance running Next.js 16 + PM2',
});
ec2Stack.addDependency(network);
ec2Stack.addDependency(database);
ec2Stack.addDependency(storage);
ec2Stack.addDependency(email);

// 8. Monitoring (CloudWatch)
const alertEmail = app.node.tryGetContext('alertEmail') as string | undefined;
const monitoring = new MonitoringStack(app, `${stackPrefix}-monitoring`, {
  env,
  config,
  ec2Instance: ec2Stack.instance,
  dbInstance: database.dbInstance,
  webhookFunction: webhook.lambdaFn,
  videoDistribution: storage.videoDistribution,
  assetDistribution: storage.assetDistribution,
  alertEmail,
  description: 'CloudWatch dashboard + alarms + SNS topic',
});
monitoring.addDependency(ec2Stack);
monitoring.addDependency(database);
monitoring.addDependency(webhook);

// 共通タグ (アプリ全体)
cdk.Tags.of(app).add('Application', config.appName);
cdk.Tags.of(app).add('Environment', config.envName);
cdk.Tags.of(app).add('ManagedBy', 'cdk');

app.synth();
