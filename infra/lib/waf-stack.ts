/**
 * WAF Stack (us-east-1 固定 / CloudFront 用 Web ACL)
 *
 * AI を使った自動攻撃 (大量のクレデンシャルスタッフィング、脆弱性スキャン、
 * SQLi / XSS ペイロードの総当たり、スクレイピング) の大半は「同じ IP から短時間に
 * 大量のリクエスト」か「既知の攻撃シグネチャ」なので、オリジン (EC2) に届く前に
 * CloudFront の前段で落とす。
 *
 * ルール (優先度順):
 *   0. AWSManagedRulesAmazonIpReputationList  … ボットネット / 既知の悪性 IP (block)
 *   1. 認証系エンドポイントのレート制限          … ログイン総当たり対策 (block)
 *   2. サイト全体のレート制限                    … DoS / 大量スクレイピング (既定 count)
 *   3. AWSManagedRulesCommonRuleSet             … OWASP Top10 系 (既定 count)
 *   4. AWSManagedRulesKnownBadInputsRuleSet     … Log4Shell 等 (既定 count)
 *   5. AWSManagedRulesSQLiRuleSet               … SQL インジェクション (既定 count)
 *
 * 誤検知でサイトを止めないよう、マネージドルールは最初 `count` (検知のみ) で入れ、
 * CloudWatch の WAF メトリクス / サンプルリクエストで誤検知が無いことを確認してから
 * context `wafManagedRulesAction=block` に切り替える運用にする (docs/SECURITY_BACKUP.md)。
 *
 * Stripe Webhook は Lambda Function URL に直接届くため、この WAF の対象外
 * (= Stripe からの通知を誤ってブロックする心配はない)。
 */
import { Stack, type StackProps, CfnOutput } from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { type AppConfig, prefix, commonTags } from './config';

export interface WafStackProps extends StackProps {
  config: AppConfig;
}

/** レート制限の対象にする認証系パス (前方一致) */
export const AUTH_RATE_LIMIT_PATHS = [
  '/api/auth/callback/credentials', // Auth.js のログイン POST
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/resend-verification-code',
  '/api/auth/verify-email',
  '/api/v1/auth/token', // Unity 等ネイティブクライアントのトークン発行
  '/api/super-admin/totp/verify',
];

export class WafStack extends Stack {
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: WafStackProps) {
    super(scope, id, props);
    const { config } = props;
    for (const [k, v] of Object.entries(commonTags(config))) {
      this.tags.setTag(k, v);
    }

    const metricPrefix = prefix(config, 'waf').replace(/-/g, '_');
    const visibility = (name: string): wafv2.CfnWebACL.VisibilityConfigProperty => ({
      cloudWatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
      metricName: `${metricPrefix}_${name}`,
    });

    const managedOverride: wafv2.CfnWebACL.OverrideActionProperty =
      config.waf.managedRulesAction === 'block' ? { none: {} } : { count: {} };

    const managedRule = (
      priority: number,
      name: string,
      overrideAction: wafv2.CfnWebACL.OverrideActionProperty,
      ruleActionOverrides?: wafv2.CfnWebACL.RuleActionOverrideProperty[],
    ): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction,
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name,
          ...(ruleActionOverrides ? { ruleActionOverrides } : {}),
        },
      },
      visibilityConfig: visibility(name),
    });

    // 認証系パスのいずれかに前方一致
    const authPathStatement: wafv2.CfnWebACL.StatementProperty = {
      orStatement: {
        statements: AUTH_RATE_LIMIT_PATHS.map((p) => ({
          byteMatchStatement: {
            fieldToMatch: { uriPath: {} },
            positionalConstraint: 'STARTS_WITH',
            searchString: p,
            textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
          },
        })),
      },
    };

    const rules: wafv2.CfnWebACL.RuleProperty[] = [
      // 0. 悪性 IP (AWS の脅威インテリジェンス)。誤検知が極めて少ないので最初から block
      managedRule(0, 'AWSManagedRulesAmazonIpReputationList', { none: {} }),

      // 1. 認証系のレート制限 (5 分 / IP)。正規ユーザーが 5 分で 100 回ログインすることは無い
      {
        name: 'RateLimitAuth',
        priority: 1,
        action: {
          block: {
            customResponse: {
              responseCode: 429,
              customResponseBodyKey: 'rate_limited',
            },
          },
        },
        statement: {
          rateBasedStatement: {
            limit: config.waf.authRateLimit,
            evaluationWindowSec: 300,
            aggregateKeyType: 'IP',
            scopeDownStatement: authPathStatement,
          },
        },
        visibilityConfig: visibility('RateLimitAuth'),
      },

      // 2. サイト全体のレート制限 (5 分 / IP)
      {
        name: 'RateLimitGlobal',
        priority: 2,
        action:
          config.waf.globalRateAction === 'block'
            ? {
                block: {
                  customResponse: { responseCode: 429, customResponseBodyKey: 'rate_limited' },
                },
              }
            : { count: {} },
        statement: {
          rateBasedStatement: {
            limit: config.waf.globalRateLimit,
            evaluationWindowSec: 300,
            aggregateKeyType: 'IP',
            // 静的アセット (_next/static) はキャッシュヒットが多く、ページ表示ごとに
            // 数十リクエスト飛ぶので集計から除外する
            scopeDownStatement: {
              notStatement: {
                statement: {
                  byteMatchStatement: {
                    fieldToMatch: { uriPath: {} },
                    positionalConstraint: 'STARTS_WITH',
                    searchString: '/_next/static/',
                    textTransformations: [{ priority: 0, type: 'NONE' }],
                  },
                },
              },
            },
          },
        },
        visibilityConfig: visibility('RateLimitGlobal'),
      },

      // 3. OWASP 系の汎用ルール。
      //    SizeRestrictions_BODY (8KB 超のボディ) は管理画面のリッチテキスト投稿や
      //    画像アップロード (multipart) を誤検知するため、常に count に落とす。
      managedRule(3, 'AWSManagedRulesCommonRuleSet', managedOverride, [
        { name: 'SizeRestrictions_BODY', actionToUse: { count: {} } },
        { name: 'CrossSiteScripting_BODY', actionToUse: { count: {} } },
      ]),

      // 4. 既知の悪性入力 (Log4Shell / Java デシリアライズ等)
      managedRule(4, 'AWSManagedRulesKnownBadInputsRuleSet', managedOverride),

      // 5. SQL インジェクション
      managedRule(5, 'AWSManagedRulesSQLiRuleSet', managedOverride),
    ];

    const webAcl = new wafv2.CfnWebACL(this, 'SiteWebAcl', {
      name: prefix(config, 'site-waf'),
      description: 'WAF for main site CloudFront distribution (rate limit + AWS managed rules)',
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      customResponseBodies: {
        rate_limited: {
          contentType: 'APPLICATION_JSON',
          content: JSON.stringify({
            error: {
              code: 'RATE_LIMITED',
              message: 'リクエストが多すぎます。しばらく時間をおいてから再度お試しください。',
            },
          }),
        },
      },
      rules,
      visibilityConfig: visibility('all'),
    });

    this.webAclArn = webAcl.attrArn;

    new CfnOutput(this, 'WebAclArn', { value: webAcl.attrArn });
  }
}
