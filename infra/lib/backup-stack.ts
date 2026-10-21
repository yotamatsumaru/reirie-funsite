/**
 * Backup Stack — ランサムウェア / 不正アクセス / 誤操作に耐えるバックアップ
 *
 * RDS 標準の自動バックアップ (PITR) は「DB インスタンスと同じ権限境界」にある。
 * 管理者の認証情報が漏れる・AI を使った自動攻撃でアカウントを乗っ取られる・
 * 誰かが誤って `cdk destroy` する、といった事態ではインスタンスと一緒に消せてしまう。
 * そこで、消せない・書き換えられない場所に複数系統でコピーを残す。
 *
 *  1) AWS Backup (物理スナップショット)
 *     - Vault Lock 付きの専用 Vault (保持期間中は削除・期間短縮が不可)
 *     - 日次 (35 日保持) + 月次 (1 年保持)
 *     - 別リージョン (既定: 大阪 ap-northeast-3) の Vault へ自動コピー
 *       → 東京リージョン障害 / 東京側の Vault 侵害にも耐える
 *     - ジョブ失敗は SNS (MonitoringStack の alerts トピック) に通知
 *
 *  2) pg_dump (論理バックアップ) 用 S3 バケット
 *     - S3 Object Lock (WORM): 保持期間中はオブジェクトの削除・上書き不可
 *     - EC2 には PutObject だけを許可 (EC2 が乗っ取られても既存ダンプは消せない)
 *     - BypassGovernanceRetention をルート以外に禁止
 *     - EC2 上の deploy/backup-db.sh が毎日アップロードし、成功メトリクスを送る。
 *       26 時間成功が無ければアラーム。
 *     - 論理ダンプは「別の PostgreSQL / 別アカウント / ローカル」でも復元できる
 *       ので、AWS アカウント自体を失った場合の最後の砦になる。
 *
 *  3) 自動復元テスト (AWS Backup Restore Testing)
 *     - 毎月 1 日に最新の復旧ポイントから一時 DB を実際に復元し、成功したら自動削除。
 *     - 失敗すれば Vault 通知 (RESTORE_JOB_FAILED) でメールが届く。
 *     - 「バックアップはあるが戻せない」を人手なしで検知する。
 */
import { Stack, type StackProps, CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';

/** 日次スナップショットの保持日数 */
export const DAILY_RETENTION_DAYS = 35;
/** 月次スナップショットの保持日数 */
export const MONTHLY_RETENTION_DAYS = 365;
/** Vault Lock の最小保持 (これより短いバックアップは Vault が受け付けない) */
const VAULT_MIN_RETENTION_DAYS = 7;
/** Vault Lock の最大保持 */
const VAULT_MAX_RETENTION_DAYS = 400;

/** pg_dump の CloudWatch メトリクス名前空間 (deploy/backup-db.sh と一致させる) */
export function dumpMetricNamespace(config: AppConfig): string {
  return `${config.appName}/Backup`;
}

/** Vault 名 (別リージョンの ARN を決め打ちで組み立てるため固定名にする) */
export function backupVaultName(config: AppConfig, kind: 'primary' | 'copy'): string {
  return prefix(config, `vault-${kind}`);
}

function lockConfiguration(config: AppConfig): backup.LockConfiguration {
  return {
    minRetention: Duration.days(VAULT_MIN_RETENTION_DAYS),
    maxRetention: Duration.days(VAULT_MAX_RETENTION_DAYS),
    // changeableFor を指定すると compliance モード (72h 後に AWS root でも解除不可)。
    // 未指定なら governance モード (特権ユーザーは解除可能)。
    ...(config.backup.vaultLockMode === 'compliance'
      ? { changeableFor: Duration.days(3) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// 別リージョン側: コピー先 Vault だけを持つ小さなスタック
// ---------------------------------------------------------------------------
export interface BackupCopyStackProps extends StackProps {
  config: AppConfig;
}

export class BackupCopyStack extends Stack {
  public readonly vault: backup.BackupVault;

  constructor(scope: Construct, id: string, props: BackupCopyStackProps) {
    super(scope, id, props);
    const { config } = props;
    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    this.vault = new backup.BackupVault(this, 'CopyVault', {
      backupVaultName: backupVaultName(config, 'copy'),
      // バックアップは常に保持 (スタックを消しても Vault は残す)
      removalPolicy: RemovalPolicy.RETAIN,
      // Vault のアクセスポリシーで DeleteRecoveryPoint を全員に拒否
      blockRecoveryPointDeletion: true,
      lockConfiguration: lockConfiguration(config),
    });

    new CfnOutput(this, 'CopyVaultArn', { value: this.vault.backupVaultArn });
  }
}

// ---------------------------------------------------------------------------
// メインリージョン側
// ---------------------------------------------------------------------------
export interface BackupStackProps extends StackProps {
  config: AppConfig;
  dbInstance: rds.IDatabaseInstance;
  /** アラート通知先 (MonitoringStack.alertTopic) */
  alertTopic: sns.ITopic;
  /** 自動復元テストの復元先 (本番と同じ閉じたサブネット / SG に復元する) */
  dbSubnetGroupName: string;
  dbSecurityGroupId: string;
}

export class BackupStack extends Stack {
  public readonly vault: backup.BackupVault;
  public readonly dumpBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: BackupStackProps) {
    super(scope, id, props);
    const { config, dbInstance, alertTopic, dbSubnetGroupName, dbSecurityGroupId } = props;

    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    // =====================================================================
    // 1) AWS Backup
    // =====================================================================
    this.vault = new backup.BackupVault(this, 'PrimaryVault', {
      backupVaultName: backupVaultName(config, 'primary'),
      removalPolicy: RemovalPolicy.RETAIN,
      blockRecoveryPointDeletion: true,
      lockConfiguration: lockConfiguration(config),
      notificationTopic: alertTopic,
      notificationEvents: [
        backup.BackupVaultEvents.BACKUP_JOB_FAILED,
        backup.BackupVaultEvents.BACKUP_JOB_EXPIRED,
        backup.BackupVaultEvents.COPY_JOB_FAILED,
        backup.BackupVaultEvents.RESTORE_JOB_FAILED,
        // 復旧ポイントの保持設定が変更されたら通知 (攻撃者による改ざんの兆候)
        backup.BackupVaultEvents.RECOVERY_POINT_MODIFIED,
      ],
    });

    // コピー先 Vault (別リージョン)。固定名なので ARN を組み立てて参照する
    // (crossRegionReferences の Custom Resource を増やさないため)。
    const copyRegion = config.backup.copyRegion;
    const copyVault = copyRegion
      ? backup.BackupVault.fromBackupVaultArn(
          this,
          'CopyVaultRef',
          `arn:aws:backup:${copyRegion}:${this.account}:backup-vault:${backupVaultName(config, 'copy')}`,
        )
      : undefined;

    const copyActions = (days: number): backup.BackupPlanCopyActionProps[] =>
      copyVault
        ? [{ destinationBackupVault: copyVault, deleteAfter: Duration.days(days) }]
        : [];

    const plan = new backup.BackupPlan(this, 'DbBackupPlan', {
      backupPlanName: prefix(config, 'db-backup'),
      backupVault: this.vault,
      backupPlanRules: [
        new backup.BackupPlanRule({
          ruleName: 'daily',
          // JST 05:00 (RDS 自動バックアップ窓 JST 02:00-03:00 とずらす。
          // AWS Backup は RDS のバックアップ窓の前後 1 時間はジョブを開始しない)
          scheduleExpression: events.Schedule.cron({ minute: '0', hour: '20' }),
          startWindow: Duration.hours(1),
          completionWindow: Duration.hours(4),
          deleteAfter: Duration.days(DAILY_RETENTION_DAYS),
          copyActions: copyActions(DAILY_RETENTION_DAYS),
        }),
        new backup.BackupPlanRule({
          ruleName: 'monthly',
          // 毎月 1 日 JST 06:00
          scheduleExpression: events.Schedule.cron({ minute: '0', hour: '21', day: '1' }),
          startWindow: Duration.hours(1),
          completionWindow: Duration.hours(6),
          deleteAfter: Duration.days(MONTHLY_RETENTION_DAYS),
          copyActions: copyActions(MONTHLY_RETENTION_DAYS),
        }),
      ],
    });

    const selection = plan.addSelection('RdsSelection', {
      backupSelectionName: prefix(config, 'rds'),
      resources: [backup.BackupResource.fromRdsDatabaseInstance(dbInstance)],
      allowRestores: true,
    });

    // =====================================================================
    // 1.5) 自動復元テスト (毎月)
    // =====================================================================
    if (config.backup.restoreTestEnabled) {
      const restorePlanName = prefix(config, 'restore-test').replace(/-/g, '_');
      const restorePlan = new backup.CfnRestoreTestingPlan(this, 'RestoreTestingPlan', {
        restoreTestingPlanName: restorePlanName,
        // 毎月 2 日 JST 10:00 (月次バックアップの翌日・営業時間内に結果が分かるように)
        scheduleExpression: 'cron(0 10 2 * ? *)',
        scheduleExpressionTimezone: 'Asia/Tokyo',
        startWindowHours: 8,
        recoveryPointSelection: {
          algorithm: 'LATEST_WITHIN_WINDOW',
          includeVaults: [this.vault.backupVaultArn],
          recoveryPointTypes: ['SNAPSHOT'],
          selectionWindowDays: 7,
        },
      });
      const restoreSelection = new backup.CfnRestoreTestingSelection(
        this,
        'RestoreTestingSelection',
        {
          restoreTestingPlanName: restorePlanName,
          restoreTestingSelectionName: 'rds',
          protectedResourceType: 'RDS',
          protectedResourceArns: [dbInstance.instanceArn],
          // BackupSelection が作成した AWS Backup サービスロール (Restores 権限付き)
          iamRoleArn: (selection.grantPrincipal as iam.IRole).roleArn,
          // 復元先は本番と同じ isolated サブネット / RDS SG。最小サイズでコストを抑える。
          restoreMetadataOverrides: {
            dbSubnetGroupName,
            vpcSecurityGroupIds: `["${dbSecurityGroupId}"]`,
            dbInstanceClass: 'db.t3.micro',
            multiAz: 'false',
            publiclyAccessible: 'false',
          },
          // 復元完了後、検証用に 1 時間残してから自動削除
          validationWindowHours: 1,
        },
      );
      restoreSelection.addDependency(restorePlan);

      // 復元ジョブの結果 (成功 / 失敗) を読みやすい文面でメール通知。
      // 成功も通知するのは「今月もテストが動いた」ことを確認できるようにするため。
      new events.Rule(this, 'RestoreJobResultRule', {
        ruleName: prefix(config, 'restore-job-result'),
        description: 'Notify AWS Backup restore job (incl. monthly restore test) results',
        eventPattern: {
          source: ['aws.backup'],
          detailType: ['Restore Job State Change'],
          detail: { status: ['COMPLETED', 'FAILED', 'ABORTED'] },
        },
        targets: [
          new eventTargets.SnsTopic(alertTopic, {
            message: events.RuleTargetInput.fromText(
              [
                `[${config.appName}-${config.envName}] AWS Backup 復元ジョブ: ${events.EventField.fromPath('$.detail.status')}`,
                `ジョブID: ${events.EventField.fromPath('$.detail.restoreJobId')}`,
                `復元元: ${events.EventField.fromPath('$.detail.resourceType')} ${events.EventField.fromPath('$.detail.recoveryPointArn')}`,
                `復元先: ${events.EventField.fromPath('$.detail.createdResourceArn')}`,
                `メッセージ: ${events.EventField.fromPath('$.detail.statusMessage')}`,
                'COMPLETED なら復元テスト成功 (一時 DB は自動削除されます)。FAILED なら docs/SECURITY_BACKUP.md の「復元テストが失敗したら」を参照。',
              ].join('\n'),
            ),
          }),
        ],
      });
    }

    // =====================================================================
    // 2) pg_dump 用 Object Lock バケット
    // =====================================================================
    const dumpRetentionDays = config.backup.dumpRetentionDays;
    const lockMode =
      config.backup.vaultLockMode === 'compliance'
        ? s3.ObjectLockRetention.compliance(Duration.days(dumpRetentionDays))
        : s3.ObjectLockRetention.governance(Duration.days(dumpRetentionDays));

    this.dumpBucket = new s3.Bucket(this, 'DbDumpBucket', {
      bucketName: `${prefix(config, 'db-dumps')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true, // Object Lock の前提条件
      objectLockEnabled: true,
      objectLockDefaultRetention: lockMode,
      // バックアップは絶対に自動削除しない
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      lifecycleRules: [
        {
          id: 'expire-old-dumps',
          // ロック期間が明けたダンプを削除 (ロック中は削除マーカーが付くだけ)
          expiration: Duration.days(dumpRetentionDays + 1),
          noncurrentVersionExpiration: Duration.days(1),
          expiredObjectDeleteMarker: false,
        },
        {
          id: 'abort-multipart',
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
    });

    // ガバナンスモードのロック解除 (BypassGovernanceRetention) と保持設定の変更を、
    // ルートユーザーと CDK のデプロイロール以外に禁止する。
    // → 日常的に使う IAM ユーザーのアクセスキーや EC2 ロールが漏れても、
    //   ロック中のダンプは削除・短縮できない。
    // ※ 管理者権限 (AdministratorAccess) を完全に奪われた場合はバケットポリシー自体を
    //   書き換えられ得る。それにも耐えたい場合は context backupVaultLockMode=compliance。
    this.dumpBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyLockBypassExceptRootAndCdk',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: [
          's3:BypassGovernanceRetention',
          's3:PutBucketObjectLockConfiguration',
          's3:PutObjectRetention',
          's3:PutObjectLegalHold',
          's3:DeleteBucket',
        ],
        resources: [this.dumpBucket.bucketArn, this.dumpBucket.arnForObjects('*')],
        conditions: {
          ArnNotLike: {
            'aws:PrincipalArn': [
              `arn:aws:iam::${this.account}:root`,
              `arn:aws:iam::${this.account}:role/cdk-*-cfn-exec-role-*`,
            ],
          },
        },
      }),
    );

    // EC2 ロールには「書き込みだけ」を許可する (読み取り・削除は不可)。
    // ロールは Ec2Stack にあるが、ここでは名前参照 + 独立した Policy リソースで付与し、
    // スタック間の循環参照を作らない。
    const ec2Role = iam.Role.fromRoleName(this, 'Ec2RoleRef', prefix(config, 'ec2-role'));
    new iam.Policy(this, 'Ec2DumpWritePolicy', {
      policyName: prefix(config, 'db-dump-write'),
      roles: [ec2Role],
      statements: [
        new iam.PolicyStatement({
          sid: 'PutDbDumpsOnly',
          actions: ['s3:PutObject'],
          resources: [this.dumpBucket.arnForObjects('pg_dump/*')],
        }),
      ],
    });

    // EC2 上のスクリプトがバケット名を解決するための SSM パラメータ
    // (EC2 ロールは /<app>/<env>/* の GetParameter を既に持っている)
    new ssm.StringParameter(this, 'DumpBucketParam', {
      parameterName: `/${config.appName}/${config.envName}/backup/dump-bucket`,
      stringValue: this.dumpBucket.bucketName,
      description: 'pg_dump 論理バックアップの保存先 (Object Lock 付き)。deploy/backup-db.sh が参照',
    });

    // ---- pg_dump の死活監視 ----
    // backup-db.sh は成功時に DbDumpSuccess=1 を送る。26 時間 1 度も届かなければアラーム。
    const dumpSuccess = new cloudwatch.Metric({
      namespace: dumpMetricNamespace(config),
      metricName: 'DbDumpSuccess',
      dimensionsMap: { Env: config.envName },
      statistic: 'Sum',
      period: Duration.hours(1),
    });
    const dumpAlarm = new cloudwatch.Alarm(this, 'DbDumpMissingAlarm', {
      alarmName: prefix(config, 'db-dump-missing'),
      alarmDescription:
        'pg_dump の論理バックアップが 26 時間以上成功していません。EC2 の ~/logs/backup-db.log を確認してください。',
      metric: dumpSuccess,
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 26,
      datapointsToAlarm: 26,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    dumpAlarm.addAlarmAction(new cwActions.SnsAction(alertTopic));

    // ---- Outputs ----
    new CfnOutput(this, 'PrimaryVaultName', { value: backupVaultName(config, 'primary') });
    new CfnOutput(this, 'CopyVault', {
      value: copyVault ? copyVault.backupVaultArn : '(disabled)',
    });
    new CfnOutput(this, 'DumpBucketName', {
      value: this.dumpBucket.bucketName,
      exportName: prefix(config, 'db-dump-bucket'),
    });
  }
}
