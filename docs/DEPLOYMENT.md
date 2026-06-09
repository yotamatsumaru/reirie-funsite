# AWS EC2 デプロイ手順書 (dev 環境)

このドキュメントは **`idol-fansite-dev`** 環境を AWS にゼロから構築する手順を示します。

| 項目 | 値 |
|---|---|
| AWS Account ID | `700918785224` |
| Region | `ap-northeast-1` (東京) |
| Env | `dev` |
| Branch | `main` (本番は `main`、開発作業は `genspark_ai_developer` を使う運用想定) |
| Repository | `https://github.com/yotamatsumaru/reirie-funsite.git` |

---

## 📋 全体フロー (所要時間: 約 1.5 ~ 2 時間)

```
[Step 0] ローカル環境準備           ~10分
[Step 1] PR #1 をマージして main に反映  ~5分
[Step 2] CDK Bootstrap            ~5分
[Step 3] SSM Parameter に最低限の secrets を登録 ~10分
[Step 4] Stripe Webhook Lambda をビルド  ~3分
[Step 5] CDK Deploy (各スタックを順次) ~45-60分
[Step 6] デプロイ後の確認 / 接続    ~15分
[Step 7] (任意) GitHub Actions OIDC 設定 ~20分
```

---

## Step 0. ローカル環境準備 (デプロイ作業者のPC)

### 必要ツール

```bash
# AWS CLI v2
aws --version              # aws-cli/2.x

# Node.js 20.20+
node -v                    # v20.20.x

# pnpm 9.15+
pnpm -v                    # 9.15.x

# CDK CLI は不要 (infra/ 内で pnpm install すれば aws-cdk が devDependencies で入る)
```

### AWS CLI 認証設定

```bash
aws configure
# AWS Access Key ID:     ********
# AWS Secret Access Key: ********
# Default region name:   ap-northeast-1
# Default output format: json

# 確認
aws sts get-caller-identity
# {
#   "Account": "700918785224",
#   "Arn": "arn:aws:iam::700918785224:user/your-name",
#   ...
# }
```

> **必要なIAM権限**: 初回は `AdministratorAccess` 推奨 (CDK が S3 / IAM / EC2 / RDS / Lambda / CloudFront / IVS / SES など多数を作成)。後で最小権限化するなら CDK の bootstrap ロールを限定する。

---

## Step 1. PR #1 をマージして main に反映

EC2 の user-data.sh は `git clone --branch main` で動くため、デプロイ前に必ず main に最新コードをマージする必要があります。

```bash
# PR #1 (genspark_ai_developer → main) を承認・マージ
gh pr merge 1 --squash --delete-branch=false

# main の確認
git checkout main && git pull
git log --oneline | head -3
# cfb41af feat(notices+maintenance): ...
# 660aa37 feat(super-admin): ...
# ...
```

---

## Step 2. CDK Bootstrap (アカウント/リージョン初回のみ)

```bash
cd infra
pnpm install

# Bootstrap (一度だけ必要)
npx cdk bootstrap aws://700918785224/ap-northeast-1
```

成功すると `CDKToolkit` という CloudFormation スタックが作られ、S3 バケット (`cdk-hnb659fds-assets-...`) と IAM ロール (`cdk-hnb659fds-cfn-exec-role-...`) が用意されます。

---

## Step 3. SSM Parameter に secrets を登録

**最低限 (dev で動かすのに必須):**

```bash
APP=idol-fansite
ENV=dev

# Auth.js シークレット (32 byte ランダム)
aws ssm put-parameter \
  --name "/$APP/$ENV/auth/secret" \
  --type SecureString \
  --value "$(openssl rand -base64 32)"

# アプリの公開 URL (EIP 確定後に上書きする。最初は空でも可)
aws ssm put-parameter \
  --name "/$APP/$ENV/app/base-url" \
  --type String \
  --value "http://localhost:3000"   # 後で EIP に書き換える
```

**Stripe (テスト用ダミーで起動可。本格的に動かすなら本物の Test mode キー):**

```bash
aws ssm put-parameter --name "/$APP/$ENV/stripe/secret-key"        --type SecureString --value "sk_test_DUMMY"
aws ssm put-parameter --name "/$APP/$ENV/stripe/publishable-key"   --type String       --value "pk_test_DUMMY"
aws ssm put-parameter --name "/$APP/$ENV/stripe/webhook-secret"    --type SecureString --value "whsec_DUMMY"
aws ssm put-parameter --name "/$APP/$ENV/stripe/price/standard-monthly" --type String  --value "price_DUMMY"
aws ssm put-parameter --name "/$APP/$ENV/stripe/price/standard-yearly"  --type String  --value "price_DUMMY"
aws ssm put-parameter --name "/$APP/$ENV/stripe/price/premium-monthly"  --type String  --value "price_DUMMY"
aws ssm put-parameter --name "/$APP/$ENV/stripe/price/premium-yearly"   --type String  --value "price_DUMMY"
```

**任意 (機能を実際に動かすときに登録):**

```bash
# CloudFront Signed URL 用 (動画配信が動くまで未登録でも起動はする)
# aws ssm put-parameter --name "/$APP/$ENV/cloudfront/key-pair-id" --type String --value "APKAXXX"
# aws ssm put-parameter --name "/$APP/$ENV/cloudfront/private-key" --type SecureString --value "$(cat cf-private.pem)"

# IVS (Live 機能を実際に動かすとき)
# aws ssm put-parameter --name "/$APP/$ENV/ivs/playback-key-pair-id" --type String --value "..."
# aws ssm put-parameter --name "/$APP/$ENV/ivs/playback-private-key" --type SecureString --value "$(cat ivs-private.pem)"

# Lawson (チケット連携を実際に動かすとき)
# aws ssm put-parameter --name "/$APP/$ENV/lawson/api-base"   --type String       --value "https://..."
# aws ssm put-parameter --name "/$APP/$ENV/lawson/api-key"    --type SecureString --value "..."
# aws ssm put-parameter --name "/$APP/$ENV/lawson/partner-id" --type String       --value "..."

# SES 送信元 (送信ドメインを SES で検証してから)
# aws ssm put-parameter --name "/$APP/$ENV/ses/from-email" --type String --value "no-reply@your-domain.com"
```

**登録結果の確認:**

```bash
aws ssm get-parameters-by-path --path "/$APP/$ENV" --recursive \
  --query "Parameters[].Name" --output table
```

---

## Step 4. Stripe Webhook Lambda をビルド

CDK の `webhook-stack` は `functions/stripe-webhook/dist/` を参照するので先にビルド:

```bash
cd functions/stripe-webhook
pnpm install
pnpm build
ls dist/    # index.js, index.js.map が生成される
```

---

## Step 5. CDK Deploy

### 推奨: 依存順に個別デプロイ (初回は順番が重要)

```bash
cd infra

# 1. Network (~3分)
pnpm deploy:network

# 2. Database (~10分: RDS インスタンス作成)
pnpm deploy:database

# 3. Storage (~15分: CloudFront 作成が遅い)
pnpm deploy:storage

# 4. Email (~2分)
pnpm deploy:email

# 5. Live (~3分: IVS Channel)
pnpm deploy:live

# 6. Webhook (~5分: Lambda + Function URL)
pnpm deploy:webhook

# 7. EC2 (~10分: インスタンス起動 + user-data 実行)
pnpm deploy:ec2

# 8. Monitoring (~3分)
pnpm deploy:monitoring
```

### 2回目以降は一括でOK

```bash
pnpm deploy   # 全スタック (差分のみ反映)
```

### 確認: 各スタックの Output

```bash
aws cloudformation describe-stacks \
  --stack-name idol-fansite-dev-ec2 \
  --query 'Stacks[0].Outputs' --output table
```

特に **`PublicIp`** が EC2 EIP。これを ブラウザで `http://<PublicIp>` でアクセスできるようになります (3-10分後)。

---

## Step 6. デプロイ後の確認

### 6-1. EC2 user-data の進捗を見る

```bash
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name idol-fansite-dev-ec2 \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' --output text)

# SSM Session Manager で接続
aws ssm start-session --target "$INSTANCE_ID"

# 接続後
sudo tail -f /var/log/user-data.log    # provisioning ログ
sudo -i -u ec2-user
pm2 status                              # web プロセスの状態
pm2 logs --nostream --lines 50          # 直近ログ
```

user-data.log の最後に `[user-data] done` と出ていれば成功。

### 6-2. APP_BASE_URL を EIP に書き換え

初回はダミーだったので、EIP が確定したら SSM を更新:

```bash
PUBLIC_IP=$(aws cloudformation describe-stacks \
  --stack-name idol-fansite-dev-ec2 \
  --query 'Stacks[0].Outputs[?OutputKey==`PublicIp`].OutputValue' --output text)

aws ssm put-parameter \
  --name "/idol-fansite/dev/app/base-url" \
  --type String \
  --value "http://${PUBLIC_IP}" \
  --overwrite

# EC2 上で .env.production を再生成 + 再起動
aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --targets "Key=tag:Application,Values=idol-fansite" \
  --parameters commands='["sudo -u ec2-user APP_BRANCH=main bash /home/ec2-user/app/deploy/deploy.sh"]'
```

### 6-3. DB マイグレーション確認

user-data.sh の中で `pnpm --filter @idol/db prisma:migrate:deploy` が実行されています。失敗していたら EC2 上で再実行:

```bash
# EC2 上
cd /home/ec2-user/app
pnpm --filter @idol/db prisma:migrate:deploy
```

### 6-4. ブラウザで確認

```
http://<PublicIp>/
```

- `/` トップページが表示される ✅
- `/signin` でメールアドレス入力可能 ✅
- (本番DBではデモログインは無効、Stripe Test の本物アカウント作成が必要)

---

## Step 7. (任意) GitHub Actions による自動デプロイの有効化

main に push したら自動デプロイされる設定。

### 7-1. OIDC IAM Role 作成

```bash
# GitHub Actions OIDC プロバイダ登録 (アカウントに1度だけ)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# trust policy を JSON で作成
cat > /tmp/trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::700918785224:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:yotamatsumaru/reirie-funsite:*" }
    }
  }]
}
EOF

# Role 作成
aws iam create-role \
  --role-name GitHubActionsDeployRole \
  --assume-role-policy-document file:///tmp/trust.json

# 必要なポリシーをアタッチ (Lambda update + SSM SendCommand + CloudFormation)
aws iam attach-role-policy --role-name GitHubActionsDeployRole \
  --policy-arn arn:aws:iam::aws:policy/AWSLambda_FullAccess
aws iam attach-role-policy --role-name GitHubActionsDeployRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMFullAccess
aws iam attach-role-policy --role-name GitHubActionsDeployRole \
  --policy-arn arn:aws:iam::aws:policy/AWSCloudFormationFullAccess
# CDK deploy も任せるなら + PowerUserAccess など

# ARN 確認
aws iam get-role --role-name GitHubActionsDeployRole --query 'Role.Arn' --output text
# arn:aws:iam::700918785224:role/GitHubActionsDeployRole
```

### 7-2. GitHub Repository Secrets 登録

GitHub リポジトリ > Settings > Secrets and variables > Actions で:

| Name | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::700918785224:role/GitHubActionsDeployRole` |
| `STRIPE_WEBHOOK_FN` | `idol-fansite-dev-stripe-webhook` (webhook-stack の output から確認) |

### 7-3. 動作確認

main に何かをコミット → push すると `.github/workflows/deploy.yml` が走ります。Actions タブで確認。

---

## 🧹 削除 (環境を消したいとき)

```bash
cd infra

# 依存逆順に削除がベター (一括だと CloudFront などが残ることがある)
pnpm cdk destroy idol-fansite-dev-monitoring  --force
pnpm cdk destroy idol-fansite-dev-ec2         --force
pnpm cdk destroy idol-fansite-dev-webhook     --force
pnpm cdk destroy idol-fansite-dev-live        --force
pnpm cdk destroy idol-fansite-dev-email       --force
pnpm cdk destroy idol-fansite-dev-storage     --force   # S3 は autoDeleteObjects=true (dev のみ)
pnpm cdk destroy idol-fansite-dev-database    --force   # RDS は snapshot 後削除
pnpm cdk destroy idol-fansite-dev-network     --force
```

> ⚠️ S3 バケットは `autoDeleteObjects: true` (dev のみ) で空にしてから削除。RDS は `RemovalPolicy.SNAPSHOT` でスナップショット保管。SSM Parameter は手動削除が必要。

---

## 💰 想定コスト (dev: 24h稼働)

| リソース | 月額目安 |
|---|---|
| EC2 t3.small × 1 (24h) | ¥3,500 |
| RDS t3.micro Single-AZ + 20GB | ¥3,000 |
| NAT Gateway × 1 | ¥6,000 |
| EIP (使用中は無料) | ¥0 |
| EBS gp3 30GB | ¥600 |
| S3 (低トラフィック) | ¥100 |
| CloudFront × 2 (PRICE_CLASS_100) | ¥500 |
| Lambda (Stripe webhook) | ¥0 (無料枠内) |
| CloudWatch Logs / Metrics | ¥500 |
| **合計** | **約 ¥14,000 ~ 18,000 / 月** |

> NAT Gateway がコストの主要因。費用を抑えたいなら、EC2 を public subnet に置く現構成 + NAT を 0 にする調整も可能。

---

## ⚠️ トラブルシューティング

### user-data がエラーで止まった
```bash
# EC2 内 (SSM Session で接続後)
sudo tail -200 /var/log/user-data.log
# 多くは pnpm install / prisma migrate / build の失敗
```

### `pm2 status` で web が `errored`
```bash
sudo -i -u ec2-user
pm2 logs web --lines 100 --nostream
# よくある: .env.production の値が空 → SSM 登録漏れ
```

### DB に接続できない
```bash
# Security Group: ec2-sg → rds-sg の 5432 が許可されているか確認
# RDS Endpoint が SSM の /idol-fansite/dev/... に書き込まれているか
psql "$DATABASE_URL"  # EC2 上で
```

### CloudFront ドメインが反映されない
```bash
# storage-stack の Output の AssetDistributionDomain / VideoDistributionDomain を
# SSM の /idol-fansite/dev/cloudfront/asset-domain などに登録 → EC2 再起動が必要
```

---

## 📚 関連ドキュメント

- `infra/README.md` — CDK スタック設計の詳細
- `docs/RUNBOOK.md` — 運用 / 障害対応
- `docs/openapi.yaml` — API 仕様
