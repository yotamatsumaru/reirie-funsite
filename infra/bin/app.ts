#!/usr/bin/env node
/**
 * AWS CDK エントリポイント
 *  全スタックを束ねて依存関係を組む
 *
 *  デプロイ順序:
 *    1. NetworkStack
 *    2. DatabaseStack       (depends on Network)
 *    3. StorageStack        (independent)
 *    3.5 DnsStack           (独立, us-east-1固定。domainName が context で指定された場合のみ、
 *                            EmailStack より先に作成し hostedZone を渡す)
 *    4. EmailStack          (domainName 指定時は DnsStack.hostedZone を渡し DKIM を自動設定。
 *                            未指定時は従来通り手動DKIM設定が必要な domain identity のみ)
 *    5. LiveStack           (depends on Storage)
 *    6. WebhookStack        (depends on Network, Database)
 *    7. Ec2Stack            (depends on Network, Database, Storage, Email)
 *    8. MonitoringStack     (depends on Ec2, Database, Webhook)
 *   10. SiteCdnStack        (depends on Ec2Stack, DnsStack。domainName 指定時のみ作成)
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
import { DnsStack } from '../lib/dns-stack';
import { SiteCdnStack } from '../lib/site-cdn-stack';

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

// 3.5 DNS (Route 53 Hosted Zone + ACM 証明書, us-east-1固定)
// domainName が context で指定された場合のみ作成。EmailStack より先に作ることで
// hostedZone を EmailStack に渡し、SES の DKIM/MAIL FROM レコードを自動作成できる。
// ACM 証明書は CloudFront にアタッチするため必ず us-east-1 でなければならない。
// メインの env.region (ap-northeast-1) とは別リージョンにスタックを作成し、
// crossRegionReferences で参照する。
let dns: DnsStack | undefined;
const usEast1Env: cdk.Environment = {
  account: config.account ?? process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1',
};
if (config.domainName) {
  dns = new DnsStack(app, `${stackPrefix}-dns`, {
    env: usEast1Env,
    crossRegionReferences: true,
    config,
    domainName: config.domainName,
    description: 'Route 53 Hosted Zone + ACM Certificate (us-east-1, for CloudFront)',
  });
}

// 4. Email (SES)
// dns が作成されていれば hostedZone を渡し、DKIM/MAIL FROM レコードを Route 53 に自動作成する。
// (hostedZone のリージョンは us-east-1 だが SES の Identity 自体はメインリージョンに置けるため、
//  crossRegionReferences 経由での参照渡しになる)
const sendingDomain = app.node.tryGetContext('sendingDomain') as string | undefined;
const email = new EmailStack(app, `${stackPrefix}-email`, {
  env,
  crossRegionReferences: true,
  config,
  sendingDomain,
  hostedZone: dns?.hostedZone,
  description: 'SES configuration set + sending policy',
});
if (dns) {
  email.addDependency(dns);
}

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

// 10. Site CDN (domainName が context で指定された場合のみ作成)
// dns は上の 3.5 で (domainName 指定時のみ) 既に作成済みなのでそれを再利用する。
// 例: cdk deploy '*-dns' '*-site-cdn' --context domainName=reirie.com
if (config.domainName && dns) {
  const siteCdn = new SiteCdnStack(app, `${stackPrefix}-site-cdn`, {
    env,
    crossRegionReferences: true,
    config,
    domainName: config.domainName,
    hostedZone: dns.hostedZone,
    certificate: dns.certificate,
    originIp: ec2Stack.elasticIp.ref,
    description: 'CloudFront distribution (main domain) + Route 53 ALIAS records',
  });
  siteCdn.addDependency(dns);
  siteCdn.addDependency(ec2Stack);
}

// 共通タグ (アプリ全体)
cdk.Tags.of(app).add('Application', config.appName);
cdk.Tags.of(app).add('Environment', config.envName);
cdk.Tags.of(app).add('ManagedBy', 'cdk');

app.synth();
