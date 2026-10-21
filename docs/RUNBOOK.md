# 運用 Runbook

本番環境の運用手順・障害対応をまとめたドキュメント。

## 目次

1. [日次オペレーション](#日次オペレーション)
2. [デプロイ手順](#デプロイ手順)
3. [シークレットローテーション](#シークレットローテーション)
4. [障害対応](#障害対応)
5. [ログ・メトリクス](#ログメトリクス)
6. [DB バックアップ・復元](#db-バックアップ復元)

---

## 日次オペレーション

### 朝の確認 (5分)

| 項目 | 確認場所 | 正常値 |
| ---- | ---- | ---- |
| EC2 ステータス | CloudWatch Dashboard | CPU < 60% |
| RDS 接続数 | RDS メトリクス | < 80 |
| Lambda エラー | CloudWatch Logs Insights | 0/h |
| Stripe Webhook 失敗 | `stripe_webhook_events` テーブル | error=null |
| 在庫アラート | `/admin` ダッシュボード | 残10未満商品の確認 |

### Stripe Webhook 失敗の確認

```sql
-- 直近24時間で処理されなかったイベント
SELECT id, type, created_at, error
FROM stripe_webhook_events
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND processed_at IS NULL
ORDER BY created_at DESC;
```

→ あれば Stripe Dashboard から手動 retry もしくは `aws lambda invoke` で再処理。

---

## デプロイ手順

### 通常デプロイ (push to main)

GitHub Actions が自動実行:

1. **CI** (`.github/workflows/ci.yml`): lint / typecheck / test / build
2. **Lambda 更新** (`.github/workflows/deploy.yml` → `deploy-lambda`): `aws lambda update-function-code`
3. **EC2 デプロイ** (`deploy-ec2` job): SSM RunCommand → `/home/ec2-user/app/deploy/deploy.sh`

### 手動デプロイ (緊急時)

```bash
# EC2 に Session Manager で接続
aws ssm start-session --target i-xxxxxxxx

# アプリ更新
sudo -u ec2-user bash /home/ec2-user/app/deploy/deploy.sh
```

`deploy.sh` の処理:
- `git pull origin main`
- `pnpm install --prod=false`
- `pnpm db:generate`
- `pnpm --filter @idol/db prisma migrate deploy`
- `pnpm --filter @idol/web build`
- `pm2 reload ecosystem.config.js --update-env`

### ロールバック

```bash
# 直前のコミットに戻す (EC2 上で実行)
cd /home/ec2-user/app
git log --oneline -5     # ハッシュを確認
git reset --hard <hash>
bash deploy/deploy.sh
```

DB マイグレーションを伴う場合は、Prisma migrate のロールバック SQL を別途準備。

---

## シークレットローテーション

すべてのシークレットは AWS SSM Parameter Store SecureString に保存。

### Stripe キーローテーション

```bash
# 1. Stripe Dashboard で新しいキーを作成
# 2. SSM に書き込み
aws ssm put-parameter \
  --name /idol/prod/stripe/secret_key \
  --type SecureString \
  --value "sk_live_xxxxx" \
  --overwrite

# 3. EC2 を再起動 (user-data が SSM から再読込)
aws ec2 reboot-instances --instance-ids i-xxxxxxxx

# 4. Lambda 環境変数を更新
aws lambda update-function-configuration \
  --function-name idol-prod-stripe-webhook \
  --environment "Variables={STRIPE_SECRET_KEY=sk_live_xxxxx,...}"

# 5. 旧キーを Stripe Dashboard で revoke
```

### AUTH_SECRET ローテーション

⚠️ ローテーションすると **全ユーザーがログアウト** される。

```bash
# 32文字以上のランダム文字列生成
openssl rand -base64 48

aws ssm put-parameter --name /idol/prod/auth/secret \
  --type SecureString --value "$(openssl rand -base64 48)" --overwrite

# EC2 再起動
```

### CloudFront 署名キーローテーション

1. CloudFront Console で新しい Public Key をアップロード
2. KeyGroup に追加 (旧キーも残す)
3. SSM `/idol/prod/cloudfront/private_key` を新しい秘密鍵に更新
4. EC2 再起動
5. 既存の署名URL (TTL内) が切れたら旧キーを KeyGroup から外す

---

## 障害対応

### EC2 がダウンした

**症状**: ヘルスチェック失敗、サイトがアクセス不可

```bash
# 1. インスタンス状態を確認
aws ec2 describe-instance-status --instance-ids i-xxxxxxxx

# 2. CloudWatch Agent でメモリ・ディスクを確認

# 3. PM2 状態確認 (Session Manager で接続後)
pm2 status
pm2 logs --lines 100

# 4. PM2 再起動
pm2 reload all

# 5. それでも復旧しない場合、インスタンス再起動
aws ec2 reboot-instances --instance-ids i-xxxxxxxx
```

⚠️ **Stripe Webhook は独立 Lambda** のため、EC2 ダウン中も決済は記録される。

### RDS が応答しない

**症状**: API が 500、`Can't reach database server`

```bash
# 1. RDS ステータス確認
aws rds describe-db-instances --db-instance-identifier idol-prod-db

# 2. CPU / 接続数 / FreeStorage を CloudWatch で確認

# 3. Performance Insights でスローク エリを特定

# 4. 接続数オーバーなら EC2 アプリ側で接続プール上限を確認
#    (Prisma: connection_limit パラメータ in DATABASE_URL)
```

### Stripe Webhook が処理されていない

```sql
-- 未処理イベントを確認
SELECT id, type, created_at, error
FROM stripe_webhook_events
WHERE processed_at IS NULL
ORDER BY created_at DESC LIMIT 20;
```

```bash
# Lambda ログを確認
aws logs tail /aws/lambda/idol-prod-stripe-webhook --since 1h --follow

# Stripe Dashboard から該当イベントを手動 resend
# Developers → Webhooks → endpoint → Resend
```

### 動画 / ライブが再生できない

**症状**: 403 Forbidden、署名URL が無効

| 原因 | 対処 |
| ---- | ---- |
| 署名鍵の不一致 | SSM の `cloudfront/private_key` と CloudFront Public Key が対応しているか確認 |
| TTL 切れ | クライアントを再読込 (4時間TTL) |
| KeyGroup から外れた | CloudFront Behavior の Trusted Key Group を確認 |
| IVS Channel が STOPPED | `aws ivs get-channel` で状態確認 |

---

## ログ・メトリクス

### CloudWatch Logs

| ロググループ | 内容 |
| ---- | ---- |
| `/aws/ec2/idol/web` | Next.js アプリログ (PM2 → CloudWatch Agent) |
| `/aws/ec2/idol/nginx` | nginx access/error |
| `/aws/lambda/idol-prod-stripe-webhook` | Stripe Webhook |
| `/aws/rds/instance/idol-prod-db/postgresql` | RDS スローク エリ |

### よく使うクエリ (CloudWatch Logs Insights)

```sql
-- アプリエラーを直近1時間で集計
fields @timestamp, @message
| filter @message like /ERROR|Error|error/
| stats count() by bin(5m)

-- レスポンスタイム p95
fields @timestamp, duration
| filter @message like /completed/
| stats percentile(duration, 95) by bin(1m)
```

### CloudWatch Alarms (発火条件)

| Alarm | 条件 | アクション |
| ---- | ---- | ---- |
| EC2-CPU-High | CPU > 80% / 5min | SNS → Email |
| RDS-CPU-High | CPU > 80% / 5min | SNS → Email |
| RDS-FreeStorage-Low | < 5GB | SNS → Email + Pager |
| Lambda-Errors | >= 3/min | SNS → Email |
| Lambda-Throttles | >= 1 | SNS → Email |

---

## DB バックアップ・復元

### 自動バックアップ

> 詳細設計・復元手順の全体は [`SECURITY_BACKUP.md`](SECURITY_BACKUP.md) を参照。

| 系統 | 内容 |
|---|---|
| RDS 自動バックアップ | PITR 5分粒度 / 14 日保持 (prod 35 日)。削除保護 ON |
| AWS Backup | 日次 35 日 + 月次 1 年。Vault Lock (削除不可) + 大阪リージョンへ自動コピー |
| pg_dump | EC2 cron 毎日 03:30 JST → S3 Object Lock バケット (30 日 WORM)。`deploy/backup-db.sh` |

失敗時アラーム: AWS Backup ジョブ失敗 (Vault 通知) / `*-db-dump-missing` (26 時間 pg_dump 成功なし)。

```bash
# pg_dump の手動実行・ログ確認 (EC2 上)
sudo -u ec2-user bash /home/ec2-user/app/deploy/backup-db.sh
tail -n 50 /home/ec2-user/logs/backup-db.log

# pg_dump から別 DB に復元 (本番 DB は触らない)
bash /home/ec2-user/app/deploy/restore-db-dump.sh /tmp/<file>.dump
```

### 手動スナップショット

```bash
aws rds create-db-snapshot \
  --db-instance-identifier idol-prod-db \
  --db-snapshot-identifier idol-prod-pre-migration-$(date +%Y%m%d)
```

### 復元手順

```bash
# 1. スナップショットから新規インスタンス復元
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier idol-prod-db-restored \
  --db-snapshot-identifier idol-prod-pre-migration-20260101

# 2. 接続テスト後、CDK の RDS Stack を更新して切り替え
# 3. アプリの DATABASE_URL を更新 (SSM)
# 4. EC2 / Lambda 再起動
```

---

## 連絡先

- オンコール: Slack #idol-oncall
- 緊急: PagerDuty (P1: 15分以内応答)
- AWS サポート: ビジネスサポート (24/7)
- Stripe サポート: dashboard.stripe.com/support


## 障害: reirie.com が 502 Bad Gateway (CloudFront「Error from cloudfront」)

### 症状
- `https://reirie.com` / `https://www.reirie.com` が 502。レスポンスヘッダに `x-cache: Error from cloudfront`
- `https://origin-app.reirie.com` (EC2 直) は 200 で正常

### 原因 (2026-10-10 に発生)
オリジン (EC2 nginx) の Let's Encrypt 証明書が失効。CloudFront はオリジンへ `HTTPS_ONLY` で
接続するため、証明書が無効だと接続を拒否して 502 を返す。アプリ・DB は正常。

### 確認
```bash
echo | openssl s_client -connect 52.196.151.93:443 -servername origin-app.reirie.com 2>/dev/null \
  | openssl x509 -noout -dates
# notAfter が過去なら失効
```

### 復旧 (1 コマンド)
```bash
# SSM Session Manager で EC2 に接続して
sudo FORCE=1 bash /home/ec2-user/app/deploy/renew-tls.sh

# または AWS CLI から
aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --targets "Key=tag:Application,Values=idol-fansite" \
  --parameters commands='["sudo certbot renew --force-renewal && sudo systemctl reload nginx"]'
```

### 再発防止
`deploy/install-cron.sh` が毎日 `deploy/renew-tls.sh` を cron 登録する (deploy.sh 実行時に自動反映)。
ログは `/var/log/renew-tls.log`。
