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

  /**
   * removalPolicy: true なら「スタック削除時にデータも破棄」する。
   *
   * ⚠️ 既定は prod/stg=false, dev=true だが、本番サイト (reirie.com) は
   *    envName=dev のスタックで稼働しているため、cdk.json の context
   *    `destroyOnRemove: false` で明示的に保護している。
   *    これが true だと RDS の削除保護が OFF になり、`cdk destroy` や
   *    盗まれた認証情報での DeleteDBInstance 1 回で DB と自動バックアップが
   *    同時に消える。
   */
  destroyOnRemove: boolean;

  /** RDS 自動バックアップ (PITR) の保持日数 (1〜35) */
  rdsBackupRetentionDays: number;

  /**
   * AWS Backup (改ざん不能な Vault + 別リージョンコピー) の設定。
   * enabled=false なら BackupStack を作成しない。
   */
  backup: {
    enabled: boolean;
    /** 別リージョンへのコピー先 (空文字ならコピーしない)。既定: 大阪 */
    copyRegion: string;
    /**
     * Vault Lock モード
     *  - governance: 削除保護あり。ただし backup:DeleteBackupVaultLockConfiguration
     *                権限を持つ管理者は解除できる (既定・安全に試せる)
     *  - compliance: 72 時間の猶予後は AWS root を含め **誰も解除・短縮できない**。
     *                ランサムウェア対策として最も強いが取り消し不能。
     */
    vaultLockMode: 'governance' | 'compliance';
    /** pg_dump (論理バックアップ) の Object Lock 保持日数 */
    dumpRetentionDays: number;
    /** 毎月の自動復元テスト (AWS Backup Restore Testing) */
    restoreTestEnabled: boolean;
  };

  /** WAF (CloudFront 用 / us-east-1)。domainName 指定時のみ有効 */
  waf: {
    enabled: boolean;
    /**
     * AWS マネージドルール (Common / SQLi / KnownBadInputs) の動作。
     *  - count: 検知してログに残すだけ (誤検知確認用。初回デプロイ推奨)
     *  - block: 遮断
     */
    managedRulesAction: 'count' | 'block';
    /** ログイン/認証 API の IP 単位レート制限 (5 分あたり) */
    authRateLimit: number;
    /** サイト全体の IP 単位レート制限 (5 分あたり) */
    globalRateLimit: number;
    /** 全体レート制限の動作 (携帯キャリアの CGNAT で IP 共有が多いため既定 count) */
    globalRateAction: 'count' | 'block';
  };

  /**
   * CloudFront の origin-facing マネージドプレフィックスリスト ID
   * (例: ap-northeast-1 では pl-58a04531)。
   * 指定すると EC2 の 443 を CloudFront からのみに制限し、WAF の迂回を防ぐ。
   * 80 番は Let's Encrypt (HTTP-01) の更新に必要なため開けたままにする
   * (nginx は 80 で https へのリダイレクトしか返さない)。
   */
  cloudFrontPrefixListId?: string;
}

function ctxBool(node: Node, key: string, fallback: boolean): boolean {
  const v = node.tryGetContext(key) as unknown;
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() === 'true' || String(v) === '1';
}

function ctxNum(node: Node, key: string, fallback: number): number {
  const v = node.tryGetContext(key) as unknown;
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`context ${key} must be a number (got ${String(v)})`);
  return n;
}

function ctxEnum<T extends string>(node: Node, key: string, allowed: readonly T[], fallback: T): T {
  const v = node.tryGetContext(key) as unknown;
  if (v === undefined || v === null || v === '') return fallback;
  if (!allowed.includes(v as T)) {
    throw new Error(`context ${key} must be one of ${allowed.join(' | ')} (got ${String(v)})`);
  }
  return v as T;
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

  const destroyOnRemove = ctxBool(node, 'destroyOnRemove', !isProd && !isStg);
  const rdsBackupRetentionDays = ctxNum(
    node,
    'rdsBackupRetentionDays',
    isProd ? 35 : destroyOnRemove ? 7 : 14,
  );
  if (rdsBackupRetentionDays < 1 || rdsBackupRetentionDays > 35) {
    throw new Error('context rdsBackupRetentionDays must be between 1 and 35');
  }
  const copyRegionRaw = node.tryGetContext('backupCopyRegion') as string | undefined;
  const cloudFrontPrefixListId =
    (node.tryGetContext('cloudFrontPrefixListId') as string | undefined) || undefined;
  if (cloudFrontPrefixListId && !/^pl-[0-9a-f]+$/.test(cloudFrontPrefixListId)) {
    throw new Error(`context cloudFrontPrefixListId looks invalid: ${cloudFrontPrefixListId}`);
  }

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
    destroyOnRemove,
    rdsBackupRetentionDays,
    backup: {
      enabled: ctxBool(node, 'backupEnabled', !destroyOnRemove),
      copyRegion: copyRegionRaw === undefined ? 'ap-northeast-3' : copyRegionRaw,
      vaultLockMode: ctxEnum(node, 'backupVaultLockMode', ['governance', 'compliance'] as const, 'governance'),
      dumpRetentionDays: ctxNum(node, 'backupDumpRetentionDays', 30),
      restoreTestEnabled: ctxBool(node, 'backupRestoreTestEnabled', true),
    },
    waf: {
      enabled: ctxBool(node, 'wafEnabled', true),
      managedRulesAction: ctxEnum(node, 'wafManagedRulesAction', ['count', 'block'] as const, 'count'),
      authRateLimit: ctxNum(node, 'wafAuthRateLimit', 100),
      globalRateLimit: ctxNum(node, 'wafGlobalRateLimit', 3000),
      globalRateAction: ctxEnum(node, 'wafGlobalRateAction', ['count', 'block'] as const, 'count'),
    },
    cloudFrontPrefixListId,
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
