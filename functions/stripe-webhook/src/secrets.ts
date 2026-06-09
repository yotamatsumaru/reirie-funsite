/**
 * SSM Parameter Store から SecureString / String を取得するヘルパー。
 *
 * Lambda Environment Variables には SecureString を直接埋め込めない (CFn 制約)。
 * そのため、SSM Parameter 名だけを環境変数で渡し、Lambda 起動時に
 * SDK 経由で値を取得 → コンテナ再利用でキャッシュする方式を採用。
 *
 * 必要な IAM: ssm:GetParameter / kms:Decrypt (SecureString の場合)
 *
 * @aws-sdk/client-ssm は Lambda Node.js 20 runtime に含まれているため
 * バンドル不要 (package.json の esbuild --external:@aws-sdk/* と整合)。
 */
import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

interface ResolvedSecrets {
  stripeSecretKey: string;
  stripeWebhookSecret: string;
}

let cache: ResolvedSecrets | null = null;

/**
 * 環境変数で指定された SSM Parameter 名から実値を一括取得 (1 回の API コール)。
 * コンテナ再利用時はキャッシュを返す。
 */
export async function getSecrets(): Promise<ResolvedSecrets> {
  if (cache) return cache;

  const secretKeyParamName = process.env.STRIPE_SECRET_KEY_PARAM;
  const webhookSecretParamName = process.env.STRIPE_WEBHOOK_SECRET_PARAM;

  if (!secretKeyParamName || !webhookSecretParamName) {
    throw new Error(
      'STRIPE_SECRET_KEY_PARAM / STRIPE_WEBHOOK_SECRET_PARAM environment variables are required',
    );
  }

  const res = await ssm.send(
    new GetParametersCommand({
      Names: [secretKeyParamName, webhookSecretParamName],
      WithDecryption: true,
    }),
  );

  const params = res.Parameters ?? [];
  const byName = new Map<string, string>();
  for (const p of params) {
    if (p.Name && p.Value) byName.set(p.Name, p.Value);
  }
  const stripeSecretKey = byName.get(secretKeyParamName);
  const stripeWebhookSecret = byName.get(webhookSecretParamName);

  if (!stripeSecretKey || !stripeWebhookSecret) {
    const missing = (res.InvalidParameters ?? []).join(', ');
    throw new Error(
      `Failed to fetch Stripe secrets from SSM. Missing: ${missing || '(unknown)'}`,
    );
  }

  const resolved: ResolvedSecrets = { stripeSecretKey, stripeWebhookSecret };
  cache = resolved;
  return resolved;
}

/**
 * テスト用にキャッシュをクリア。
 */
export function _resetSecretsCache(): void {
  cache = null;
}
