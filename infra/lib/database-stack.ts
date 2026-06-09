/**
 * Database Stack
 *  - RDS PostgreSQL 15
 *  - Secrets Manager (admin user)
 *  - Subnet Group: isolated subnets
 *  - パラメータグループ (timezone, log_statement)
 */
import { Stack, type StackProps, CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';

export interface DatabaseStackProps extends StackProps {
  config: AppConfig;
  vpc: ec2.IVpc;
  rdsSecurityGroup: ec2.ISecurityGroup;
}

export class DatabaseStack extends Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);
    const { config, vpc, rdsSecurityGroup } = props;

    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    // パラメータグループ (Asia/Tokyo / 日本語ロケール / 監査ログ)
    const parameterGroup = new rds.ParameterGroup(this, 'PgParamGroup', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      description: `${prefix(config, 'pg15')} parameter group`,
      parameters: {
        'rds.force_ssl': '1',
        timezone: 'Asia/Tokyo',
        log_min_duration_statement: '1000', // 1秒超のクエリをログ
      },
    });

    // 管理ユーザー Secret
    const dbSecret = new secretsmanager.Secret(this, 'DbAdminSecret', {
      secretName: prefix(config, 'rds-admin'),
      description: 'RDS PostgreSQL admin credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'idol_admin' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
        passwordLength: 32,
      },
    });
    this.dbSecret = dbSecret;

    // インスタンスタイプ解決 (config.rdsInstanceType="t3.medium" 形式)
    const [, size] = config.rdsInstanceType.split('.');
    const instanceClass = ec2.InstanceClass.T3;
    const instanceSize =
      size === 'medium'
        ? ec2.InstanceSize.MEDIUM
        : size === 'small'
          ? ec2.InstanceSize.SMALL
          : ec2.InstanceSize.MICRO;

    this.dbInstance = new rds.DatabaseInstance(this, 'PgInstance', {
      instanceIdentifier: prefix(config, 'rds'),
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(instanceClass, instanceSize),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [rdsSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: 'idol_fansite',
      port: 5432,
      multiAz: config.rdsMultiAz,
      allocatedStorage: config.rdsAllocatedStorage,
      maxAllocatedStorage: config.rdsAllocatedStorage * 5,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      backupRetention: Duration.days(config.envName === 'prod' ? 14 : 7),
      preferredBackupWindow: '17:00-18:00', // JST 02:00-03:00
      preferredMaintenanceWindow: 'sun:18:00-sun:19:00', // JST 日曜 03:00-04:00
      deleteAutomatedBackups: config.destroyOnRemove,
      deletionProtection: !config.destroyOnRemove,
      removalPolicy: config.destroyOnRemove ? RemovalPolicy.DESTROY : RemovalPolicy.SNAPSHOT,
      parameterGroup,
      enablePerformanceInsights: config.envName === 'prod',
      cloudwatchLogsExports: ['postgresql'],
      autoMinorVersionUpgrade: true,
      publiclyAccessible: false,
    });

    // ---- Outputs ----
    new CfnOutput(this, 'DbEndpoint', {
      value: this.dbInstance.dbInstanceEndpointAddress,
      exportName: prefix(config, 'db-endpoint'),
    });
    new CfnOutput(this, 'DbPort', {
      value: this.dbInstance.dbInstanceEndpointPort,
      exportName: prefix(config, 'db-port'),
    });
    new CfnOutput(this, 'DbSecretArn', {
      value: dbSecret.secretArn,
      exportName: prefix(config, 'db-secret-arn'),
    });
  }
}
