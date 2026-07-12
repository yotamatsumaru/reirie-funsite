# Infra (AWS CDK)

アイドルファンサイトの AWS インフラを CDK (TypeScript) で定義。

## スタック構成

| # | スタック | 主なリソース | 依存 |
|---|---|---|---|
| 1 | `*-network` | VPC, Subnets (public/private/isolated), NAT, SG (EC2/RDS/Lambda), S3 GW Endpoint | - |
| 2 | `*-database` | RDS PostgreSQL 15, パラメータグループ, Secrets Manager (admin) | network |
| 3 | `*-storage` | S3 (videos/assets/media-output), CloudFront × 2, OAC, signed URL Key Group | - |
| 4 | `*-email` | SES Configuration Set, IAM ManagedPolicy, SNS (Bounce/Complaint) | - |
| 5 | `*-live` | IVS Channel (PRIVATE), Recording Configuration, Playback Key Pair | storage |
| 6 | `*-webhook` | Stripe Webhook Lambda, Function URL, VPC内配置, SSM 参照 | network, database |
| 7 | `*-ec2` | EC2 (Amazon Linux 2023) + EIP + IAM Role + UserData | network, database, storage, email |
| 8 | `*-monitoring` | CloudWatch Dashboard, Alarms (EC2/RDS/Lambda), SNS Topic | ec2, database, webhook |

## 環境

context (`cdk.json` or `--context`) で切替:

| key | 値 |
|---|---|
| `appName` | アプリ名 (デフォルト `idol-fansite`) |
| `envName` | `dev` / `stg` / `prod` |
| `region` | `ap-northeast-1` |
| `account` | AWS Account ID |
| `domainName` | `example.com` (Cloudflare 管理) |
| `sendingDomain` | SES 送信元ドメイン |
| `cloudfrontPublicKeyPem` | VOD signed URL 用の公開鍵 (PEM) |
| `ivsPlaybackPublicKeyPem` | IVS Playback signed URL 用 EC 公開鍵 (PEM) |
| `alertEmail` | アラート通知先 |
| `appRepoUrl` | EC2 user-data からクローンするリポジトリ |

## デプロイ手順

### 0. 事前準備

```bash
# AWS CLI と CDK の初期セットアップ
aws configure --profile idol-fansite
export AWS_PROFILE=idol-fansite
cd infra && pnpm install

# CDK Bootstrap (アカウント/リージョンごと初回のみ)
pnpm run bootstrap
```

### 1. SSM Parameter に secrets を登録

```bash
APP=idol-fansite
ENV=dev

# Stripe
aws ssm put-parameter --name "/$APP/$ENV/stripe/secret-key" --type SecureString --value "sk_live_..."
aws ssm put-parameter --name "/$APP/$ENV/stripe/webhook-secret" --type SecureString --value "whsec_..."
aws ssm put-parameter --name "/$APP/$ENV/stripe/price/standard-monthly" --type String --value "price_..."
aws ssm put-parameter --name "/$APP/$ENV/stripe/price/standard-yearly" --type String --value "price_..."
aws ssm put-parameter --name "/$APP/$ENV/stripe/price/premium-monthly" --type String --value "price_..."
aws ssm put-parameter --name "/$APP/$ENV/stripe/price/premium-yearly" --type String --value "price_..."

# Auth.js
aws ssm put-parameter --name "/$APP/$ENV/auth/secret" --type SecureString --value "$(openssl rand -base64 32)"

# CloudFront / IVS 秘密鍵
aws ssm put-parameter --name "/$APP/$ENV/cloudfront/private-key" --type SecureString --value "$(cat cf-private.pem)"
aws ssm put-parameter --name "/$APP/$ENV/cloudfront/key-pair-id" --type String --value "APKA..."
aws ssm put-parameter --name "/$APP/$ENV/ivs/playback-private-key" --type SecureString --value "$(cat ivs-private.pem)"
aws ssm put-parameter --name "/$APP/$ENV/ivs/playback-key-pair-id" --type String --value "..."

# Lawson Ticket API (本番のみ)
aws ssm put-parameter --name "/$APP/$ENV/lawson/api-key" --type SecureString --value "..."
aws ssm put-parameter --name "/$APP/$ENV/lawson/partner-id" --type String --value "..."
```

### 2. Stripe Webhook Lambda をビルド

```bash
cd functions/stripe-webhook
pnpm install
pnpm run build      # esbuild で dist/index.js を生成
```

### 3. CDK Deploy

```bash
cd infra

# 初回は依存順で個別デプロイがおすすめ
pnpm run deploy:network
pnpm run deploy:database     # 5-10分
pnpm run deploy:storage      # CloudFront 作成で10-15分
pnpm run deploy:email
pnpm run deploy:live
pnpm run deploy:webhook
pnpm run deploy:ec2
pnpm run deploy:monitoring

# 2回目以降は一括
pnpm run deploy
```

### 4. デプロイ後の手動作業

1. **Stripe Dashboard**: Webhook エンドポイントを `*-webhook` の Function URL に設定し、`whsec_*` を SSM に再保存
2. **Cloudflare DNS**: `*-ec2` の Output `PublicIp` を A レコードに設定 (Proxied/オレンジ雲)
3. **Cloudflare DNS**: `*-storage` の `VideoDistributionDomain` / `AssetDistributionDomain` を CNAME に設定
4. **SES**: `sendingDomain` の DKIM CNAME を Cloudflare に追加し検証完了
5. **Cloudflare Full/Strict HTTPS**: Origin CA 証明書を発行 → `/<app>/<env>/tls/cert-pem` `/tls/key-pem` に SSM 登録 →
   EC2 上で `deploy/setup-tls.sh` を実行 (443 を有効化)。詳細手順は `docs/DEPLOYMENT.md` の Step 6.5 を参照
6. **EC2**: SSM Session Manager で接続し `pm2 status` を確認

```bash
# SSM Session Manager で EC2 に接続
aws ssm start-session --target <instance-id>
sudo -i -u ec2-user
pm2 status
pm2 logs
```

## 削除

```bash
# 開発環境のみ可 (prod は deletionProtection で守られている)
pnpm run destroy
```

`*-storage` の S3 バケットは `autoDeleteObjects: true` (dev のみ) で空にしてから削除。
RDS は `RemovalPolicy.SNAPSHOT` でスナップショット保管。

## 設計上の留意点

- **VPC 構成**: NAT × 2 (prod) で AZ 障害耐性。dev は NAT × 1 でコスト最小化。
- **Stripe Webhook 分離**: EC2 障害時も Webhook を取りこぼさないよう Lambda 化 (Q3.B 採用)。
- **Cloudflare 連携**: ドメイン/SSL は Cloudflare で完結。CDK は IP/ドメインを Output に出すのみ。
- **Secrets 管理**: 機密値は **すべて SSM SecureString**。CDK code には埋め込まない。
- **リージョン**: 全リソース `ap-northeast-1`。CloudFront のメトリクスのみ `us-east-1` 経由で取得。
