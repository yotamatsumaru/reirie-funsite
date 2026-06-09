/**
 * 環境別の設定を集約
 * - bin/app.ts から context 経由で渡される envName / appName を解決
 */
import type { Construct } from 'constructs';
import { Node } from 'constructs';

export interface AppConfig {
  appName: string;
  envName: 'dev' | 'stg' | 'prod';
  region: string;
  account?: string;

  /** ドメイン (Cloudflare で管理されているのでホスト名のみ参照) */
  domainName?: string;

  /** EC2 インスタンスタイプ */
  ec2InstanceType: string;
  /** EC2 起動時に GitHub から pull する想定のリポジトリ (CodeDeploy 不使用版) */
  appRepoUrl?: string;
  /** EC2 が pull する Git ブランチ (デフォルト `main`) */
  appBranch: string;

  /** RDS */
  rdsInstanceType: string;
  rdsAllocatedStorage: number;
  rdsMultiAz: boolean;

  /** CloudFront */
  cloudfrontPriceClass: 'PRICE_CLASS_100' | 'PRICE_CLASS_200' | 'PRICE_CLASS_ALL';

  /** removalPolicy: dev は破棄 / prod は保持 */
  destroyOnRemove: boolean;
}

export function loadConfig(scope: Construct): AppConfig {
  const node = Node.of(scope);
  const appName = (node.tryGetContext('appName') as string) ?? 'idol-fansite';
  const envName = ((node.tryGetContext('envName') as string) ?? 'dev') as
    | 'dev'
    | 'stg'
    | 'prod';
  const region =
    (node.tryGetContext('region') as string) ??
    process.env.CDK_DEFAULT_REGION ??
    'ap-northeast-1';
  const account =
    (node.tryGetContext('account') as string) ?? process.env.CDK_DEFAULT_ACCOUNT;
  const domainName = node.tryGetContext('domainName') as string | undefined;

  const isProd = envName === 'prod';
  const isStg = envName === 'stg';

  return {
    appName,
    envName,
    region,
    account,
    domainName,
    ec2InstanceType: isProd ? 't3.medium' : 't3.small',
    appRepoUrl: node.tryGetContext('appRepoUrl') as string | undefined,
    appBranch: (node.tryGetContext('appBranch') as string) ?? 'main',
    rdsInstanceType: isProd ? 't3.medium' : 't3.micro',
    rdsAllocatedStorage: isProd ? 100 : 20,
    rdsMultiAz: isProd,
    cloudfrontPriceClass: isProd ? 'PRICE_CLASS_200' : 'PRICE_CLASS_100',
    destroyOnRemove: !isProd && !isStg,
  };
}

/**
 * リソース名のプレフィクス
 *  例: idol-fansite-dev-ec2, idol-fansite-prod-rds
 */
export function prefix(cfg: AppConfig, resource: string): string {
  return `${cfg.appName}-${cfg.envName}-${resource}`;
}

/**
 * リソースタグ
 */
export function commonTags(cfg: AppConfig): Record<string, string> {
  return {
    Application: cfg.appName,
    Environment: cfg.envName,
    ManagedBy: 'cdk',
  };
}
