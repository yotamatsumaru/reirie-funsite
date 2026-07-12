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
[Step 6.5/6.6] 独自ドメイン紐付け (Cloudflare or Route 53+CloudFront、任意) ~30-60分
[Step 6.7] SES 送信ドメイン検証 + 本番アクセス申請 (一斉メール送信を行う場合) ~10分 + 承認待ち24-48h
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

# Cloudflare Origin CA 証明書 (独自ドメイン + Full/Strict HTTPS を有効化するとき。詳細は Step 6.5)
# aws ssm put-parameter --name "/$APP/$ENV/tls/cert-pem" --type SecureString --value "$(cat origin-cert.pem)"
# aws ssm put-parameter --name "/$APP/$ENV/tls/key-pem"  --type SecureString --value "$(cat origin-key.pem)"
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

# 3.5 DNS (~1-5分。Route 53 Hosted Zone 作成は数秒だが、ACM 証明書の DNS 検証待ちで
#     数分かかることがある。domainName を指定する場合のみ実行。
#     独自ドメインで SES の DKIM を Route 53 で自動検証したい場合は、
#     Email より先にこのステップを実行しておく)
pnpm deploy:dns --context domainName=reirie.com
# → 初回のみ: Output `NameServers` の値をお名前.com 等のネームサーバー設定に登録
#   (反映まで数時間〜24時間かかることがある。詳細は Step 6.6 を参照)

# 4. Email (~2分。domainName を指定していれば SES の DKIM/MAIL FROM レコードが
#     Route 53 の Hosted Zone に自動作成される。ドメイン移管が済んでいない場合は
#     レコードは作成されるが検証は Pending のままになる — ネームサーバー反映後に自動で Verified になる)
pnpm deploy:email --context domainName=reirie.com --context sendingDomain=reirie.com

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

user-data.sh の中で `pnpm --filter @idol/db prisma:migrate:deploy` が実行されています
(通常運用では `main` への push で GitHub Actions → SSM 経由の `deploy/deploy.sh` が同じコマンドを
自動実行するため、追加のお知らせ配信 (`announcements` テーブル) 等の新規マイグレーションも
デプロイ時に自動適用される)。失敗していたら EC2 上で再実行:

```bash
# EC2 上
cd /home/ec2-user/app
pnpm --filter @idol/db prisma:migrate:deploy
```

> `_prisma_migrations` 管理テーブルが本番RDSにまだ存在しない (過去に `db push` 運用だった) 場合、
> `migrate deploy` は最初の未適用マイグレーションから順に再生しようとしてエラーになることがある。
> 個別マイグレーションを安全に反映する手順は `packages/db/prisma/migrations/README.md` を参照
> (SQL直接実行 + `prisma migrate resolve --applied`)。

### 6-4. ブラウザで確認

```
http://<PublicIp>/
```

- `/` トップページが表示される ✅
- `/signin` でメールアドレス入力可能 ✅
- (本番DBではデモログインは無効、Stripe Test の本物アカウント作成が必要)

---

## Step 6.5. ドメイン紐付け (Cloudflare + Full/Strict HTTPS)

`reirie.com` を EC2 (`52.196.151.93` 等の EIP) に紐付け、Cloudflare Full/Strict で
エンドツーエンド HTTPS を有効化する手順。**この Step はすべて AWS コンソール /
Cloudflare ダッシュボードでの操作**であり、リポジトリの `deploy/user-data.sh` /
`deploy/setup-tls.sh` が Cloudflare Origin CA 証明書を検知して自動で 443 を
有効化する仕組みは実装済み (このコミットで追加)。

### 6.5-1. ドメインを Cloudflare に追加 (ネームサーバー移管)

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログイン → **Add a site** → `reirie.com` を入力
2. Cloudflare が提示する既存 DNS レコードのスキャン結果を確認 (見落としがあれば後で手動追加)
3. プラン選択 (Free で可)
4. Cloudflare が指定する **2つのネームサーバー** (例: `xxx.ns.cloudflare.com`, `yyy.ns.cloudflare.com`) を確認
5. ドメイン登録会社 (お名前.com / Route53 / Google Domains 等、`reirie.com` を購入した会社) の管理画面にログインし、
   ネームサーバーを Cloudflare 指定の2つに変更
6. 反映待ち (数分〜24時間、通常は1時間以内)。Cloudflare Dashboard 上で
   ステータスが **Active** になれば完了

### 6.5-2. DNS レコード追加 (Cloudflare Dashboard > DNS > Records)

| Type | Name | Content | Proxy status |
|---|---|---|---|
| A | `@` (reirie.com) | `52.196.151.93` (EC2 の EIP) | 🟠 Proxied |
| A | `www` | `52.196.151.93` | 🟠 Proxied |
| CNAME | `assets` (任意) | `*-storage` スタックの `AssetDistributionDomain` | 🟠 Proxied |
| CNAME | `videos` (任意) | `*-storage` スタックの `VideoDistributionDomain` | 🟠 Proxied |

> **Proxied (オレンジ雲) にすること。** Grey cloud (DNS only) だと Cloudflare の
> TLS 終端・CDN・WAF が効かず、オリジン IP がそのまま露出する。

### 6.5-3. Cloudflare Origin CA 証明書を発行 (Full/Strict 用)

1. Cloudflare Dashboard → 対象ドメイン → **SSL/TLS** → **Origin Server** タブ
2. **Create Certificate** をクリック
3. Key type: `RSA (2048)` (デフォルトで可)
4. Hostnames: `reirie.com`, `*.reirie.com` (ワイルドカードで一括カバー)
5. Certificate Validity: `15 years` (デフォルト)
6. **Create** すると **Origin Certificate (PEM)** と **Private Key (PEM)** が表示される
   → **この画面を閉じると秘密鍵は再表示できないので、必ずこの場でコピーして保存すること**

### 6.5-4. 証明書を SSM Parameter Store に登録

```bash
# ローカルに一時保存した PEM から登録 (values はダッシュボードでコピーした内容をそのまま貼る)
aws ssm put-parameter \
  --name "/idol-fansite/dev/tls/cert-pem" \
  --type SecureString \
  --value "$(cat origin-cert.pem)" \
  --overwrite

aws ssm put-parameter \
  --name "/idol-fansite/dev/tls/key-pem" \
  --type SecureString \
  --value "$(cat origin-key.pem)" \
  --overwrite

# 登録確認 (値は SecureString なので --output text では見えない。存在確認のみ)
aws ssm get-parameters-by-path --path "/idol-fansite/dev/tls" --query "Parameters[].Name"
```

### 6.5-5. EC2 上で証明書を反映 (再起動不要)

SSM Session Manager で EC2 に接続し、リポジトリに追加済みの `deploy/setup-tls.sh` を実行:

```bash
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name idol-fansite-dev-ec2 \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' --output text)

aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --targets "Key=tag:Application,Values=idol-fansite" \
  --parameters commands='["cd /home/ec2-user/app && git pull --ff-only && sudo APP_NAME=idol-fansite ENV_NAME=dev AWS_REGION=ap-northeast-1 bash deploy/setup-tls.sh"]'
```

または SSM Session Manager で直接ログインして:

```bash
aws ssm start-session --target "$INSTANCE_ID"
sudo -i
cd /home/ec2-user/app && git pull --ff-only
APP_NAME=idol-fansite ENV_NAME=dev AWS_REGION=ap-northeast-1 bash deploy/setup-tls.sh
```

実行後、nginx が `listen 443 ssl` で起動し、80 は 443 への 301 リダイレクトになる。
`nginx -t` の構文チェックに失敗した場合は自動で反映されないため、エラーメッセージを確認すること。

> 📝 補足: EC2 を **新規に作り直す場合** (`userDataCausesReplacement` により UserData 変更時は
> インスタンスが再作成される) は、事前に Step 6.5-4 で SSM に証明書を登録しておけば
> `deploy/user-data.sh` が起動時に自動検出して最初から 443 で立ち上がる。
> `setup-tls.sh` は「既存インスタンスに後から証明書を反映する」ためのショートカット。

### 6.5-6. Cloudflare SSL/TLS モードを Full (strict) に設定

1. Cloudflare Dashboard → **SSL/TLS** → **Overview**
2. 暗号化モードを **Full (strict)** に設定
   (オリジンが Cloudflare Origin CA 証明書を提示しているため `strict` で検証可能)
3. **Edge Certificates** タブ → **Always Use HTTPS** を ON
   (Cloudflare が HTTP アクセスを自動で HTTPS にリダイレクト)

### 6.5-7. APP_BASE_URL をドメインに書き換え

```bash
aws ssm put-parameter \
  --name "/idol-fansite/dev/app/base-url" \
  --type String \
  --value "https://reirie.com" \
  --overwrite

# .env.production を再生成 + PM2 再起動 (AUTH_URL / NEXT_PUBLIC_APP_BASE_URL もここで更新される)
aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --targets "Key=tag:Application,Values=idol-fansite" \
  --parameters commands='["sudo -u ec2-user APP_BRANCH=main bash /home/ec2-user/app/deploy/deploy.sh"]'
```

> ⚠️ `AUTH_URL` (Auth.js) がドメインと不一致だと、Cookie の Secure 属性やコールバック URL の
> 検証で問題が起きる場合がある。必ず `https://reirie.com` (末尾スラッシュなし) に統一すること。

### 6.5-8. 動作確認

```bash
curl -I https://reirie.com/          # 200 OK, Strict-Transport-Security ヘッダを確認
curl -I http://reirie.com/           # 301 → https://reirie.com/ (Cloudflare が返す)
```

- ブラウザで `https://reirie.com/` にアクセスし、鍵アイコン (有効な証明書) を確認 ✅
- `https://reirie.com/signin` でログインフローが正常に動くか確認 (特に Stripe Checkout の
  リダイレクト URL がドメインベースになっているか) ✅
- Stripe Webhook の Endpoint URL もドメインが変わる場合は Stripe Dashboard 側で更新が必要
  (今回は Lambda Function URL 経由のため対象外)

### トラブルシューティング: Cloudflare が 521/522 を返す

- `521 Web Server Is Down`: オリジン (EC2) の 443 が閉じている、または nginx が起動していない
  → `sudo systemctl status nginx` / `sudo nginx -t` で確認
- `522 Connection Timed Out`: セキュリティグループで 443 が閉じている、または EIP が変わった
  → `infra/lib/network-stack.ts` の `ec2SecurityGroup` で 443 が ingress 許可されているか確認 (デフォルトで許可済み)
- 証明書エラー (`ERR_SSL_VERSION_OR_CIPHER_MISMATCH` 等): Cloudflare SSL/TLS モードが
  `Full (strict)` なのに、オリジンに正しい証明書が乗っていない → Step 6.5-3〜6.5-5 を再実施

---

## Step 6.6. ドメイン紐付け (Route 53 + CloudFront、Cloudflare の代替構成)

`reirie.com` は **お名前.com で購入・所有を継続** しつつ、DNS 管理だけを Route 53 に
委譲し、CloudFront ディストリビューション経由で EC2 (EIP) をオリジンとして配信する構成。
Step 6.5 (Cloudflare) の代わりにこちらを使う場合の手順。CDK 側の実装
(`infra/lib/dns-stack.ts` / `infra/lib/site-cdn-stack.ts` / `infra/bin/app.ts`) は
実装済みで、`config.domainName` (= `cdk.json` の context か `--context domainName=...`)
が指定されたときだけ `*-dns` / `*-site-cdn` スタックが作られる。

### なぜ Route 53 が必要か (お名前.com の制約)

お名前.com の DNS は **ALIAS/ANAME レコードに対応していない**。CloudFront や CDK の
`RecordTarget.fromAlias()` が生成する CloudFront ドメイン (`dxxxxxxxxxxxxx.cloudfront.net`)
は、ルートドメイン (apex, `reirie.com` 自体) に対して **CNAME を張れない** ため、
お名前.com のネームサーバーのままではルートドメインを CloudFront に紐付けられない。
Route 53 の ALIAS レコードはこの制約を回避できる AWS 独自機能のため、DNS 管理のみを
Route 53 に移行する。**ドメインの購入・更新契約自体はお名前.com のまま変更不要。**

### アーキテクチャ概要

```
ブラウザ
  │ https://reirie.com/ , https://www.reirie.com/
  ▼
CloudFront (SiteCdnStack, ACM証明書 us-east-1)
  │ Host ヘッダーを origin-app.reirie.com に書き換えて転送
  │ CloudFront Function (viewer-request) が元の Host を
  │ X-Forwarded-Host ヘッダーにコピーしてから転送
  ▼
Route 53 内部 A レコード: origin-app.reirie.com → EC2 EIP (52.196.151.93)
  ▼
EC2 (nginx) : X-Forwarded-Host を受け取り Next.js (Auth.js trustHost) に橋渡し
```

### 6.6-1. Route 53 Hosted Zone + ACM 証明書を作成 (DnsStack, us-east-1)

```bash
cd infra
pnpm install   # 初回のみ

# us-east-1 も CDK Bootstrap が必要 (ACM 証明書は CloudFront 用に us-east-1 固定のため)
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1

npx cdk deploy 'idol-fansite-dev-dns' --context domainName=reirie.com --require-approval never
```

- Output `NameServers` (カンマ区切り4件、例: `ns-xxx.awsdns-xx.com, ...`) をメモする
- Output `CertificateArn` / `HostedZoneId` も後続の確認用にメモ (Output は CloudFormation
  コンソール、または `aws cloudformation describe-stacks --stack-name idol-fansite-dev-dns` でも確認可能)

> ⚠️ この時点では ACM 証明書はまだ **Pending validation** のままで良い
> (Route 53 に DNS 検証レコードが自動作成されるが、ネームサーバーがまだ
> お名前.com を向いているため外部から解決できず、検証は完了しない)。

### 6.6-2. お名前.com でネームサーバーを Route 53 に変更

1. お名前.com Navi にログイン → **ドメイン設定** → **ネームサーバーの変更**
2. 対象ドメイン `reirie.com` を選択 → **その他のネームサーバーを使う**
3. 6.6-1 で取得した Route 53 の **4つのネームサーバー** をすべて入力
   (お名前.com は4つ入力欄があるので、Route 53 が返す4件をそのまま入れる)
4. 設定確認 → 反映 (反映まで数分〜24時間程度かかる場合がある。DNS TTL に依存)

反映確認:

```bash
dig NS reirie.com +short
# → Route 53 の4つのネームサーバーが返ってくれば OK
```

反映されると、Route 53 が自動で作った ACM の DNS 検証レコードが外部から解決できるようになり、
数分〜数十分で ACM 証明書のステータスが **Issued** に変わる (ACM コンソール、または
`aws acm describe-certificate --certificate-arn <ARN> --region us-east-1 --query 'Certificate.Status'` で確認)。

### 6.6-3. CloudFront ディストリビューションを作成 (SiteCdnStack)

ACM 証明書が **Issued** になったことを確認してから実行する
(Pending のまま `*-site-cdn` を deploy すると CloudFront の作成でエラーになる):

```bash
npx cdk deploy 'idol-fansite-dev-site-cdn' --context domainName=reirie.com --require-approval never
```

- Output `DistributionDomainName` (例: `dxxxxxxxxxxxxx.cloudfront.net`) をメモ
- Output `OriginHostname` (`origin-app.reirie.com`) — CloudFront が EC2 に接続する際に使う内部ホスト名。
  このスタックが Route 53 に A レコードを作成済みなので追加作業は不要
- 同時に `reirie.com` / `www.reirie.com` → CloudFront への ALIAS (A) レコードも Route 53 に作成される

このコマンドは `crossRegionReferences: true` により us-east-1 (`*-dns`) の証明書/ホストゾーンを
ap-northeast-1 (`*-site-cdn`) から自動で参照する。証明書 ARN を手動でコピーする必要はない。

### 6.6-4. EC2 (nginx) 側で `origin-app.reirie.com` 宛のリクエストを受け付けられるか確認

- CloudFront は EC2 のオリジンに対して **HTTPS (443)** で接続する設定
  (`OriginProtocolPolicy.HTTPS_ONLY`) になっているため、EC2 側に有効な TLS 証明書が
  443 で listen されている必要がある。Step 6.5-3〜6.5-5 (Cloudflare Origin CA 証明書) を
  実施していない場合は、**Let's Encrypt など何らかの証明書で 443 を有効化しておくこと**。
  Cloudflare を併用しない構成 (CloudFront のみ) の場合、`origin-app.reirie.com` に対する
  証明書としては自己署名証明書でも良い場合がある
  (CloudFront のオリジン検証を `originSslProtocols` のみに絞れば CA 検証は行われないため。
  ただし将来的に検証を厳格化する場合は Let's Encrypt 等の正規証明書を推奨)。
- nginx は `X-Forwarded-Host` ヘッダーを Next.js アプリへ橋渡しする設定が
  `deploy/user-data.sh` / `deploy/setup-tls.sh` に実装済み (このコミットで追加)。
  既存 EC2 に反映する場合は Step 6.5-5 と同様に `setup-tls.sh` を実行するか、
  UserData を変更してインスタンスを再作成する。

### 6.6-5. APP_BASE_URL とAuth.js の trustHost を確認

```bash
aws ssm put-parameter \
  --name "/idol-fansite/dev/app/base-url" \
  --type String \
  --value "https://reirie.com" \
  --overwrite

aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --targets "Key=tag:Application,Values=idol-fansite" \
  --parameters commands='["sudo -u ec2-user APP_BRANCH=main bash /home/ec2-user/app/deploy/deploy.sh"]'
```

`apps/web/src/auth.ts` の `trustHost` は `AUTH_TRUST_HOST=true` (本番) で有効化されており、
CloudFront Function が転送する `X-Forwarded-Host` (`reirie.com` / `www.reirie.com`) を
Auth.js がそのまま信頼してコールバック URL 等を組み立てる。EC2 直アクセス時など
`X-Forwarded-Host` が無い場合は nginx が `$host` にフォールバックする。

### 6.6-6. 動作確認

```bash
curl -I https://reirie.com/            # 200 OK, CloudFront 経由 (x-cache ヘッダ等で確認可能)
curl -I https://www.reirie.com/        # 200 OK
curl -I http://reirie.com/             # 301 → https://reirie.com/ (CloudFront の REDIRECT_TO_HTTPS)
dig reirie.com +short                  # CloudFront の Anycast IP が複数返る
```

- ブラウザで `https://reirie.com/` にアクセスし、鍵アイコン (ACM 証明書) を確認 ✅
- CloudFront のキャッシュ挙動: `/_next/static/*` は `CACHING_OPTIMIZED` (長期キャッシュ)、
  それ以外は `CACHING_DISABLED` (毎回オリジンへ、Cookie ベースのログイン状態を反映するため) ✅
- デプロイ直後は CloudFront の初回配信反映まで **15〜30分程度** かかる場合がある

### トラブルシューティング (Route 53 / CloudFront)

- `cdk deploy '*-site-cdn'` が ACM 証明書エラーで失敗する
  → 6.6-2 のネームサーバー反映が完了していない、または ACM 証明書がまだ `Pending validation`。
    `aws acm describe-certificate ... --query 'Certificate.Status'` で `ISSUED` になるまで待つ
- CloudFront が `502/504` を返す
  → オリジン (`origin-app.reirie.com` = EC2 EIP) の 443 が閉じている、または nginx が
    落ちている。`HTTPS_ONLY` 設定のため EC2 側で 443 (TLS) が必須 (80 のみでは動かない)
- ログイン後にリダイレクトが `origin-app.reirie.com` になってしまう
  → CloudFront Function (`ForwardHostFunction`) が正しく関連付けられているか、
    nginx の `X-Forwarded-Host` 転送 (`deploy/user-data.sh`) が反映されているか、
    `AUTH_TRUST_HOST=true` が EC2 の `.env.production` に設定されているかを確認
- nginx の error.log に `upstream sent too big header while reading response header
  from upstream` が出て 502 になる
  → Next.js のレスポンスヘッダー (Cookie/セッション情報等) が nginx のデフォルトの
    proxy buffer サイズを超えている。`deploy/user-data.sh` / `deploy/setup-tls.sh` は
    `proxy_buffer_size 128k` / `proxy_buffers 4 256k` / `proxy_busy_buffers_size 256k`
    を設定済み (このコミットで追加)。既存 EC2 に反映するには `setup-tls.sh` を再実行するか、
    `/etc/nginx/conf.d/app.conf` に直接同設定を追記して `nginx -t && systemctl reload nginx`

---

## Step 6.7. SES 送信ドメイン検証 + 本番アクセス申請 (一斉メール送信を行う場合)

お知らせの一斉メール送信 (`apps/web/src/lib/bulk-email.ts`) や会員登録時の確認コードメール、
Stripe 決済完了メールなどを実際に送るには、SES の **送信ドメイン検証** と
**サンドボックス解除 (Production Access)** が必要。

### 6.7-1. 送信ドメインの DKIM 検証

**A. Route 53 を使っている場合 (Step 6.6 済み、推奨)**

`*-dns` を先にデプロイしてから `*-email` を `domainName` / `sendingDomain` 付きで
デプロイしていれば ([Step 5](#step-5-cdk-deploy) 参照)、DKIM (CNAME×3) と
MAIL FROM (MX/TXT=SPF) のレコードが Route 53 Hosted Zone に自動作成されている。
追加のDNS作業は不要で、以下で検証完了を待つだけ:

```bash
aws ses get-identity-verification-attributes --identities reirie.com \
  --query 'VerificationAttributes."reirie.com".VerificationStatus' --output text
# "Success" になれば検証完了 (ネームサーバー移管直後は Pending のことがある。反映まで最大24時間)

aws ses get-identity-dkim-attributes --identities reirie.com \
  --query 'DkimAttributes."reirie.com".DkimVerificationStatus' --output text
# こちらも "Success" になっていることを確認
```

**B. Route 53 を使わない場合 (Cloudflare 等で DNS 管理、`domainName` 未指定)**

`*-email` の CloudFormation イベントか、AWS Console → SES → Verified identities →
対象ドメイン → DKIM タブに表示される 3件の CNAME レコードを、DNS 管理側 (Cloudflare 等) に
手動で追加する。加えて MAIL FROM 用に `bounce.<domain>` の MX (`feedback-smtp.<region>.amazonses.com`,
priority 10) と TXT (`v=spf1 include:amazonses.com ~all`) レコードも追加する
(詳細な値は Console の MAIL FROM domain タブに表示される)。

### 6.7-2. 送信元メールアドレスを SSM に登録 (未登録の場合)

```bash
aws ssm put-parameter --name "/idol-fansite/dev/ses/from-email" \
  --type String --value "no-reply@reirie.com" --overwrite
```

`apps/web/src/lib/email.ts` はこの値 (`SES_FROM_EMAIL` 環境変数経由) を送信元として使う。

### 6.7-3. SES サンドボックスモードの確認

新規 SES アカウントは既定で **サンドボックスモード** であり、以下の制限がある:

- 送信先メールアドレスも SES で検証済みでなければ送信できない (未検証の一般会員には送れない)
- 送信レートが低く制限される (24時間あたりの送信数・秒間送信数に上限あり)

```bash
# 注意: get-account は aws ses (v1) には存在しない。aws sesv2 を使うこと。
aws sesv2 get-account --query 'ProductionAccessEnabled' --output text
# false ならまだサンドボックス
```

### 6.7-4. 本番アクセス (Production Access) の申請

サンドボックスモードのままでは一般会員へのメール送信ができないため、本番運用前に必ず申請する。

1. AWS Console → **SES → Account dashboard** → 右上 **「Request production access」** をクリック
2. 申請フォームに以下を入力:
   - **Mail type**: `Transactional` (確認コード・お知らせ配信メールが中心の場合) または
     `Marketing`（一斉お知らせを主目的とする場合。両方使う場合は `Transactional` を選び、
     用途の説明欄でお知らせ配信についても触れる）
   - **Website URL**: `https://reirie.com`
   - **Use case description**: 具体例:
     > 会員制ファンサイトです。(1) 新規登録時の本人確認 (6桁コード) メール、
     > (2) 運営からのお知らせを opt-in 会員へ配信する一斉メール、
     > (3) 決済完了・サブスクリプション関連の通知メールを送信します。
     > すべて会員本人が登録したメールアドレス宛のみに送信し、
     > お知らせ配信は marketingOptIn (配信同意) フラグで制御しています。
   - **Additional contacts**: 運営の連絡先メールアドレス
   - **Preferred contact language**: Japanese
   - バウンス/クレーム対応: 「`*-email` スタックが作成する SNS Topic
     (`idol-fansite-<env>-ses-bounce` / `-ses-complaint`) で監視し、
     一定率を超えたら送信を停止する」旨を記載すると承認されやすい
3. 申請後、AWS サポートからの回答を待つ (通常 24〜48時間)
4. 承認されたら `aws sesv2 get-account --query 'ProductionAccessEnabled'` が `true` になる

### 6.7-5. Bounce / Complaint 通知の subscribe (推奨)

```bash
BOUNCE_TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name idol-fansite-dev-email \
  --query 'Stacks[0].Outputs[?OutputKey==`BounceTopicArn`].OutputValue' --output text)
aws sns subscribe --topic-arn "$BOUNCE_TOPIC_ARN" --protocol email --notification-endpoint ops@reirie.com

COMPLAINT_TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name idol-fansite-dev-email \
  --query 'Stacks[0].Outputs[?OutputKey==`ComplaintTopicArn`].OutputValue' --output text)
aws sns subscribe --topic-arn "$COMPLAINT_TOPIC_ARN" --protocol email --notification-endpoint ops@reirie.com
```

購読確認メールのリンクをクリックして完了。以降、バウンス/クレーム発生時に通知が届く。

### トラブルシューティング (SES)

- 一斉送信 (`sendAnnouncementEmails`) が全件 `emailStatus: FAILED` になる
  → サンドボックスモードのまま未検証の宛先に送っている可能性が高い。6.7-3/6.7-4 を確認
- DKIM が `Pending` のまま変わらない
  → Route 53 移管の場合、ネームサーバー反映 (最大24時間) 待ち。`dig txt reirie.com` 等で
    まず該当ゾーンが正しく Route 53 を向いているか確認
- 本番アクセス申請が Reject された
  → Use case description が具体性不足なことが多い。誰に何を送るか・opt-in の仕組み・
    バウンス対応方針を明記して再申請する

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
