/**
 * Monitoring Stack
 *  - CloudWatch Dashboard (EC2 / RDS / Lambda / CloudFront のメトリクス)
 *  - CloudWatch Alarms (CPU / メモリ / DB接続 / Lambda エラー / 5xx)
 *  - SNS Topic (アラート通知の集約 - email subscribe は手動)
 */
import {
  Stack,
  type StackProps,
  CfnOutput,
  Duration,
} from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';

export interface MonitoringStackProps extends StackProps {
  config: AppConfig;
  ec2Instance: ec2.IInstance;
  dbInstance: rds.IDatabaseInstance;
  webhookFunction: lambda.IFunction;
  videoDistribution?: cloudfront.IDistribution;
  assetDistribution?: cloudfront.IDistribution;
  /** 通知先の email (任意) */
  alertEmail?: string;
}

export class MonitoringStack extends Stack {
  public readonly alertTopic: sns.Topic;
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const {
      config,
      ec2Instance,
      dbInstance,
      webhookFunction,
      videoDistribution,
      assetDistribution,
      alertEmail,
    } = props;

    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    // ---- アラート通知 SNS Topic ----
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: prefix(config, 'alerts'),
      displayName: `${config.appName} ${config.envName} alerts`,
    });
    if (alertEmail) {
      new sns.Subscription(this, 'AlertEmailSub', {
        topic: this.alertTopic,
        protocol: sns.SubscriptionProtocol.EMAIL,
        endpoint: alertEmail,
      });
    }
    const snsAction = new cwActions.SnsAction(this.alertTopic);

    // ---- EC2 Alarms ----
    const ec2CpuMetric = new cloudwatch.Metric({
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      dimensionsMap: { InstanceId: ec2Instance.instanceId },
      period: Duration.minutes(5),
      statistic: 'Average',
    });
    const ec2CpuAlarm = new cloudwatch.Alarm(this, 'Ec2CpuAlarm', {
      alarmName: prefix(config, 'ec2-cpu-high'),
      metric: ec2CpuMetric,
      threshold: 80,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    ec2CpuAlarm.addAlarmAction(snsAction);

    const ec2StatusMetric = new cloudwatch.Metric({
      namespace: 'AWS/EC2',
      metricName: 'StatusCheckFailed',
      dimensionsMap: { InstanceId: ec2Instance.instanceId },
      period: Duration.minutes(1),
      statistic: 'Sum',
    });
    const ec2StatusAlarm = new cloudwatch.Alarm(this, 'Ec2StatusAlarm', {
      alarmName: prefix(config, 'ec2-status-failed'),
      metric: ec2StatusMetric,
      threshold: 1,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    ec2StatusAlarm.addAlarmAction(snsAction);

    // ---- RDS Alarms ----
    const rdsCpuMetric = new cloudwatch.Metric({
      namespace: 'AWS/RDS',
      metricName: 'CPUUtilization',
      dimensionsMap: { DBInstanceIdentifier: dbInstance.instanceIdentifier },
      period: Duration.minutes(5),
      statistic: 'Average',
    });
    const rdsCpuAlarm = new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
      alarmName: prefix(config, 'rds-cpu-high'),
      metric: rdsCpuMetric,
      threshold: 80,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    rdsCpuAlarm.addAlarmAction(snsAction);

    const rdsStorageMetric = new cloudwatch.Metric({
      namespace: 'AWS/RDS',
      metricName: 'FreeStorageSpace',
      dimensionsMap: { DBInstanceIdentifier: dbInstance.instanceIdentifier },
      period: Duration.minutes(15),
      statistic: 'Average',
    });
    const rdsStorageAlarm = new cloudwatch.Alarm(this, 'RdsStorageAlarm', {
      alarmName: prefix(config, 'rds-storage-low'),
      metric: rdsStorageMetric,
      threshold: 5 * 1024 * 1024 * 1024, // 5GB 未満
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    });
    rdsStorageAlarm.addAlarmAction(snsAction);

    // ---- Lambda (Stripe Webhook) Alarms ----
    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'WebhookErrorAlarm', {
      alarmName: prefix(config, 'webhook-errors'),
      metric: webhookFunction.metricErrors({
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 3,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    lambdaErrorAlarm.addAlarmAction(snsAction);

    const lambdaThrottleAlarm = new cloudwatch.Alarm(this, 'WebhookThrottleAlarm', {
      alarmName: prefix(config, 'webhook-throttles'),
      metric: webhookFunction.metricThrottles({
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    lambdaThrottleAlarm.addAlarmAction(snsAction);

    // ---- Dashboard ----
    this.dashboard = new cloudwatch.Dashboard(this, 'AppDashboard', {
      dashboardName: prefix(config, 'dashboard'),
    });

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'EC2 - CPU & Network',
        left: [ec2CpuMetric],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'NetworkIn',
            dimensionsMap: { InstanceId: ec2Instance.instanceId },
            period: Duration.minutes(5),
            statistic: 'Sum',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'NetworkOut',
            dimensionsMap: { InstanceId: ec2Instance.instanceId },
            period: Duration.minutes(5),
            statistic: 'Sum',
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'RDS - CPU / Connections / Storage',
        left: [
          rdsCpuMetric,
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'DatabaseConnections',
            dimensionsMap: { DBInstanceIdentifier: dbInstance.instanceIdentifier },
            period: Duration.minutes(5),
            statistic: 'Average',
          }),
        ],
        right: [rdsStorageMetric],
        width: 12,
      }),
    );

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Stripe Webhook Lambda',
        left: [
          webhookFunction.metricInvocations({ period: Duration.minutes(5) }),
          webhookFunction.metricErrors({ period: Duration.minutes(5) }),
          webhookFunction.metricThrottles({ period: Duration.minutes(5) }),
        ],
        right: [webhookFunction.metricDuration({ period: Duration.minutes(5) })],
        width: 24,
      }),
    );

    if (videoDistribution || assetDistribution) {
      const cfWidgets: cloudwatch.IWidget[] = [];
      if (videoDistribution) {
        cfWidgets.push(
          new cloudwatch.GraphWidget({
            title: 'CloudFront - Video',
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/CloudFront',
                metricName: 'Requests',
                dimensionsMap: {
                  DistributionId: videoDistribution.distributionId,
                  Region: 'Global',
                },
                period: Duration.minutes(5),
                statistic: 'Sum',
                region: 'us-east-1',
              }),
            ],
            right: [
              new cloudwatch.Metric({
                namespace: 'AWS/CloudFront',
                metricName: '4xxErrorRate',
                dimensionsMap: {
                  DistributionId: videoDistribution.distributionId,
                  Region: 'Global',
                },
                period: Duration.minutes(5),
                statistic: 'Average',
                region: 'us-east-1',
              }),
              new cloudwatch.Metric({
                namespace: 'AWS/CloudFront',
                metricName: '5xxErrorRate',
                dimensionsMap: {
                  DistributionId: videoDistribution.distributionId,
                  Region: 'Global',
                },
                period: Duration.minutes(5),
                statistic: 'Average',
                region: 'us-east-1',
              }),
            ],
            width: 12,
          }),
        );
      }
      if (assetDistribution) {
        cfWidgets.push(
          new cloudwatch.GraphWidget({
            title: 'CloudFront - Assets',
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/CloudFront',
                metricName: 'Requests',
                dimensionsMap: {
                  DistributionId: assetDistribution.distributionId,
                  Region: 'Global',
                },
                period: Duration.minutes(5),
                statistic: 'Sum',
                region: 'us-east-1',
              }),
            ],
            width: 12,
          }),
        );
      }
      this.dashboard.addWidgets(...cfWidgets);
    }

    // ---- Outputs ----
    new CfnOutput(this, 'AlertTopicArn', {
      value: this.alertTopic.topicArn,
      exportName: prefix(config, 'alert-topic-arn'),
    });
    new CfnOutput(this, 'DashboardName', {
      value: this.dashboard.dashboardName,
      exportName: prefix(config, 'dashboard-name'),
    });
  }
}
