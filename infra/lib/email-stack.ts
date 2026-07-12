/**
 * Email Stack (Amazon SES)
 *  - 送信ドメイン (DKIM 含む)
 *  - 送信用 IAM ポリシー (EC2 Role / Lambda Role に attach 用)
 *  - Bounce / Complaint 用 SNS Topic (運用時に subscribe)
 *
 *  ドメイン検証 (DKIM CNAME 3件 + MAIL FROM の MX/TXT(SPF)) の自動化:
 *   - `hostedZone` (DnsStack.hostedZone, Route 53 Public Hosted Zone) が渡された場合は
 *     `Identity.publicHostedZone(hostedZone)` を使い、DKIM/MAIL FROM レコードを
 *     Route 53 に自動作成する (手動でのCNAME登録は不要)。
 *   - `hostedZone` が無い場合は `Identity.domain(sendingDomain)` にフォールバックし、
 *     DKIM CNAME は運用者が DNS 管理側 (Cloudflare 等) で手動設定する必要がある。
 */
import { Stack, type StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import type * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';

export interface EmailStackProps extends StackProps {
  config: AppConfig;
  /** 送信元ドメイン (例: example.com) */
  sendingDomain?: string;
  /**
   * 送信元ドメインを管理する Route 53 Public Hosted Zone。
   * 指定すると DKIM / MAIL FROM レコードが自動作成される (DnsStack.hostedZone を渡す想定)。
   * DnsStack が us-east-1 で作られる場合は crossRegionReferences での参照渡しが必要。
   */
  hostedZone?: route53.IPublicHostedZone;
}

export class EmailStack extends Stack {
  public readonly sendingPolicy: iam.ManagedPolicy;
  public readonly bounceTopic: sns.Topic;
  public readonly complaintTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);
    const { config, sendingDomain, hostedZone } = props;

    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    // ドメイン Identity (DKIM 含む) — sendingDomain が指定されている時のみ
    let configurationSetName: string | undefined;
    if (sendingDomain) {
      const configSet = new ses.ConfigurationSet(this, 'SesConfigSet', {
        configurationSetName: prefix(config, 'ses-config'),
        sendingEnabled: true,
        reputationMetrics: true,
      });
      configurationSetName = configSet.configurationSetName;

      // hostedZone があれば Route 53 に DKIM/MAIL FROM レコードを自動作成、
      // 無ければ従来通り Identity.domain() (DKIM CNAME は手動設定が必要)。
      const identity = hostedZone
        ? ses.Identity.publicHostedZone(hostedZone)
        : ses.Identity.domain(sendingDomain);

      new ses.EmailIdentity(this, 'SesDomainIdentity', {
        identity,
        dkimSigning: true,
        mailFromDomain: `bounce.${sendingDomain}`,
        configurationSet: configSet,
      });
    }

    // SNS Topics: Bounce / Complaint 監視
    this.bounceTopic = new sns.Topic(this, 'BounceTopic', {
      topicName: prefix(config, 'ses-bounce'),
      displayName: 'SES Bounce Notifications',
    });
    this.complaintTopic = new sns.Topic(this, 'ComplaintTopic', {
      topicName: prefix(config, 'ses-complaint'),
      displayName: 'SES Complaint Notifications',
    });

    // 送信用 IAM ポリシー
    this.sendingPolicy = new iam.ManagedPolicy(this, 'SesSendPolicy', {
      managedPolicyName: prefix(config, 'ses-send-policy'),
      description: 'Allow sending emails via SES',
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ses:SendEmail', 'ses:SendRawEmail', 'ses:SendTemplatedEmail'],
          resources: ['*'],
          ...(configurationSetName
            ? {
                conditions: {
                  StringEquals: {
                    'ses:FromAddress': sendingDomain
                      ? `no-reply@${sendingDomain}`
                      : '*',
                  },
                },
              }
            : {}),
        }),
      ],
    });

    // ---- Outputs ----
    new CfnOutput(this, 'SesSendPolicyArn', {
      value: this.sendingPolicy.managedPolicyArn,
      exportName: prefix(config, 'ses-send-policy-arn'),
    });
    new CfnOutput(this, 'BounceTopicArn', {
      value: this.bounceTopic.topicArn,
      exportName: prefix(config, 'ses-bounce-topic'),
    });
    new CfnOutput(this, 'ComplaintTopicArn', {
      value: this.complaintTopic.topicArn,
      exportName: prefix(config, 'ses-complaint-topic'),
    });
  }
}
