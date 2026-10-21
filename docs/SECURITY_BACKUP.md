# セキュリティ強化 & DB バックアップ設計

AI を使った自動攻撃 (クレデンシャルスタッフィング・脆弱性スキャン・大量スクレイピング)
とランサムウェア / アカウント乗っ取りに備えた構成と運用手順。

---

## 1. 何から守るのか (脅威と対策の対応表)

| 脅威 | 起きること | 対策 | 実装 |
|---|---|---|---|
| ログイン総当たり / リスト型攻撃 (AI で高速化) | アカウント乗っ取り | WAF の認証 API レート制限 (5分100回/IP) + アプリ側アカウントロック (5回失敗で15分) | `waf-stack.ts`, `lib/login-lockout.ts` |
| 脆弱性スキャン / SQLi / XSS / Log4Shell 等 | 侵入・情報漏えい | AWS マネージドルール (Common / SQLi / KnownBadInputs) + 悪性 IP リスト | `waf-stack.ts` |
| 大量アクセス / スクレイピング | サイト停止 | サイト全体レート制限 (5分3000回/IP) | `waf-stack.ts` |
| オリジン IP に直接アクセスして WAF を回避 | 上記対策が無効 | EC2 の 443 を CloudFront のみに制限 (任意) | `network-stack.ts` |
| 管理者の認証情報漏えい → DB 削除 | **全データ消失** | RDS 削除保護 ON・削除時スナップショット・Vault Lock 付き AWS Backup | `database-stack.ts`, `backup-stack.ts` |
| ランサムウェア (データを暗号化・削除して身代金要求) | バックアップごと消される | 改ざん不能 (WORM) な保存先 × 2 系統 + 別リージョン | `backup-stack.ts` |
| 東京リージョン障害 | 復旧不能 | 大阪リージョンへ自動コピー | `backup-stack.ts` |
| AWS アカウントそのものを失う | 復旧不能 | pg_dump (どこでも復元できる形式) を毎日保存 → 定期的に手元にも退避 | `deploy/backup-db.sh` |
| S3 の画像・動画の誤削除 / 上書き | コンテンツ消失 | バージョニング (旧版を 14〜30 日保持) | `storage-stack.ts` |
| 誤って `cdk destroy` | 全スタック削除 | `destroyOnRemove=false` で全データを RETAIN、`destroy` スクリプトから `--force` 削除 | `cdk.json`, `package.json` |
| 不正操作の痕跡が残らない | 原因究明できない | RDS の接続ログ・DDL ログ (DROP/ALTER/TRUNCATE) を CloudWatch Logs に記録 | `database-stack.ts` |

---

## 2. バックアップの全体像 (3 系統)

```
                       ┌───────────────────────────────────────────────┐
                       │  RDS PostgreSQL (東京)  削除保護 ON             │
                       └───────┬──────────────────┬──────────────┬─────┘
                               │                  │              │
       (A) RDS 自動バックアップ │  (B) AWS Backup   │   (C) pg_dump │ (EC2 cron 03:30)
           PITR 14日 (5分粒度) │   日次35日/月次1年 │   毎日        │
                               ▼                  ▼              ▼
                    RDS 内部保管       Vault (東京) 🔒      S3 Object Lock 🔒
                                        │ 自動コピー         (30日 WORM)
                                        ▼
                                  Vault (大阪) 🔒
```

| 系統 | 用途 | 粒度 / 保持 | 消せるか |
|---|---|---|---|
| (A) RDS 自動バックアップ (PITR) | 「5 分前に戻したい」(誤更新・誤削除) | 任意時刻 / 14 日 (prod 35 日) | DB インスタンス削除時に消える可能性あり → 削除保護で防止 |
| (B) AWS Backup | 「昨日 / 先月の状態に戻したい」、ランサムウェア | 日次 35 日 + 月次 365 日、大阪にも同じ世代 | **Vault Lock: 保持期間中は削除・期間短縮不可** |
| (C) pg_dump | AWS 外への復元、テーブル単位の部分復元 | 日次 / 30 日 | **Object Lock: 保持期間中は削除・上書き不可**。EC2 は書き込みのみ |

### Vault Lock / Object Lock のモード

`cdk.json` の `backupVaultLockMode`:

| モード | 意味 | 推奨 |
|---|---|---|
| `governance` (既定) | 通常の管理者は削除不可。ルートユーザー / CDK デプロイロールは解除可 | まずはこちらで運用開始 |
| `compliance` | **72 時間の猶予後は AWS ルートユーザーでも解除・短縮不可** | 運用が安定したら切替を推奨 (ランサムウェアに最強) |

> ⚠️ `compliance` は取り消せません。保持期間中のストレージ料金も止められません。
> 切り替えたら 72 時間以内なら `aws backup delete-backup-vault-lock-configuration` で取り消せます。

---

## 3. 初回デプロイ手順

```bash
cd infra
pnpm install

# 0) 差分確認 (必ず実施。RDS が Replace になっていないことを確認する)
npx cdk diff --context domainName=reirie.com

# 1) 既存スタックの保護設定を反映 (RDS 削除保護 ON / ログ設定 / S3 バージョニング)
#    ※ いずれもダウンタイム無し (RDS のパラメータは dynamic、DeletionProtection は即時)
npx cdk deploy '*-database' '*-storage' '*-network' --context domainName=reirie.com

# 2) バックアップ (大阪の Vault → 東京の Backup Plan / ダンプ用バケットの順に作られる)
pnpm run deploy:backup --context domainName=reirie.com

# 3) WAF (us-east-1) → CloudFront にアタッチ
npx cdk deploy '*-waf' '*-site-cdn' --context domainName=reirie.com

# 4) アラート通知先 (未設定なら) — 失敗通知を受け取るために必須
npx cdk deploy '*-monitoring'   # alertEmail は cdk.json に設定済み (yotamatsumaru@gmail.com)
#    → 届いた確認メールの "Confirm subscription" を必ずクリック
```

### EC2 側 (pg_dump の cron 登録)

`deploy/deploy.sh` は毎回 `install-cron.sh` を実行するので、通常のデプロイで自動登録されます。
手動で行う場合:

```bash
aws ssm start-session --target <instance-id>
sudo bash /home/ec2-user/app/deploy/install-cron.sh

# 動作確認 (ダンプ + 検証のみ、S3 には送らない)
sudo -u ec2-user DRY_RUN=1 bash /home/ec2-user/app/deploy/backup-db.sh

# 本番実行 (S3 へアップロード)
sudo -u ec2-user bash /home/ec2-user/app/deploy/backup-db.sh
tail -n 20 /home/ec2-user/logs/backup-db.log
```

> RDS のサーバーは PostgreSQL 15 です。EC2 の `pg_dump` も 15 以上が必要です
> (`user-data.sh` で `postgresql15` をインストール済み)。

---

## 4. WAF の運用 (count → block への切替)

マネージドルールは誤検知でサイトを止めないよう **検知のみ (count)** で入れています。
デプロイから 1〜2 週間後に以下を行います。

### 手順 1: 検知状況を見る

```bash
bash deploy/security-ops.sh waf-report 14     # 直近 14 日のルール別 Count / Block 件数
```

### 手順 2: Count が多いルールの中身を確認

```bash
bash deploy/security-ops.sh waf-samples AWSManagedRulesCommonRuleSet
bash deploy/security-ops.sh waf-samples AWSManagedRulesSQLiRuleSet
bash deploy/security-ops.sh waf-samples AWSManagedRulesKnownBadInputsRuleSet
```

(コンソールで見る場合: AWS コンソール → リージョンを **バージニア北部 (us-east-1)** →
WAF & Shield → Web ACLs → `idol-fansite-dev-site-waf` → **Sampled requests**)

判断基準:

| 検知されたリクエスト | 判断 |
|---|---|
| `/wp-admin`, `/.env`, `/phpmyadmin`, `' OR 1=1`, `${jndi:` など、サイトに存在しない URL や攻撃文字列 | 攻撃 → **block して OK** |
| 自分が管理画面で記事投稿・画像アップロード・決済した時刻・URL と一致する | **誤検知** → 手順 3' へ |

> 自分の操作かどうか確かめるには、検知リストの IP と https://checkip.amazonaws.com で
> 表示される自分の IP を見比べてください。

### 手順 3: block に切り替える

`infra/cdk.json` の 1 行を変更してデプロイ:

```diff
-    "wafManagedRulesAction": "count"
+    "wafManagedRulesAction": "block"
```

```bash
cd infra
npx cdk deploy '*-waf' --context domainName=reirie.com
```

反映は 1〜2 分。切り替え後に、管理画面ログイン → 記事投稿 → 画像アップロード → (テストモードで) 決済
を一通り試して、403 が出ないことを確認してください。

**もし問題が出たら** cdk.json を `"count"` に戻して同じコマンドで即座に元に戻せます。

### 手順 3': 誤検知があった場合

`waf-samples` の最後の列 (サブルール名、例 `GenericRFI_BODY`) を
`infra/lib/waf-stack.ts` の該当ルールの `ruleActionOverrides` に追加すると、
そのサブルールだけ count のまま、他は block にできます:

```ts
managedRule(3, 'AWSManagedRulesCommonRuleSet', managedOverride, [
  { name: 'SizeRestrictions_BODY', actionToUse: { count: {} } },
  { name: 'CrossSiteScripting_BODY', actionToUse: { count: {} } },
  { name: 'GenericRFI_BODY', actionToUse: { count: {} } },   // ← 追加
]),
```

### (任意) サイト全体のレート制限も遮断する

`RateLimitGlobal` (5 分 3000 回 / IP) は携帯キャリアの IP 共有を考慮して count にしています。
`waf-report` で RateLimitGlobal の Count が攻撃っぽい IP だけなら
`"wafGlobalRateAction": "block"` を cdk.json に追加して同様にデプロイします。

| ルール | 初期動作 | 備考 |
|---|---|---|
| AmazonIpReputationList | **block** | 誤検知ほぼ無し |
| RateLimitAuth (ログイン等 100回/5分/IP) | **block** | 429 JSON を返す |
| RateLimitGlobal (3000回/5分/IP) | count | `wafGlobalRateAction=block` で遮断 |
| CommonRuleSet / KnownBadInputs / SQLi | count | 上記手順で block へ |

### オリジン直アクセスの遮断 (推奨)

CloudFront を経由せず EC2 の IP (52.196.151.93) に直接 HTTPS でアクセスされると WAF を回避されます。
CloudFront のマネージドプレフィックスリスト ID を調べて context に設定すると、443 を CloudFront からのみに制限します。

```bash
aws ec2 describe-managed-prefix-lists --region ap-northeast-1 \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query 'PrefixLists[0].PrefixListId' --output text
# → pl-xxxxxxxx

npx cdk deploy '*-network' --context cloudFrontPrefixListId=pl-xxxxxxxx
```

> 80 番は Let's Encrypt の証明書更新 (HTTP-01) に必要なため開けたままです
> (nginx は 80 で https へのリダイレクトしか返しません)。
> 適用後は `https://origin-app.reirie.com` への **ブラウザからの直接アクセスはできなくなります**
> (RUNBOOK の 502 切り分けは EC2 上から `curl -k https://127.0.0.1` で行ってください)。

---

## 5. 復元手順

### (A) 数分〜数日前の任意時点に戻す (PITR)

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier idol-fansite-dev-rds \
  --target-db-instance-identifier idol-fansite-dev-rds-pitr \
  --restore-time 2026-10-21T01:23:00Z \
  --db-subnet-group-name <既存のサブネットグループ> \
  --vpc-security-group-ids <rds-sg の ID> \
  --no-publicly-accessible
```

### (B) AWS Backup の復旧ポイントから戻す

```bash
# 復旧ポイント一覧 (東京)
aws backup list-recovery-points-by-backup-vault \
  --backup-vault-name idol-fansite-dev-vault-primary \
  --query 'RecoveryPoints[].[CreationDate,RecoveryPointArn,Status]' --output table

# 東京が使えない場合は大阪
aws backup list-recovery-points-by-backup-vault --region ap-northeast-3 \
  --backup-vault-name idol-fansite-dev-vault-copy --output table
```

コンソール (AWS Backup → Backup vaults → 復旧ポイント → **Restore**) から新しい DB インスタンス名を
指定して復元するのが確実です。復元先は **必ず新しいインスタンス名** にしてください。

### (C) pg_dump から戻す (テーブル単位も可)

EC2 ロールにはダンプの **読み取り権限がありません** (乗っ取られても持ち出せないようにするため)。
運用者が自分の認証情報でダウンロードし、EC2 に渡します。

```bash
# 運用者の PC で
aws s3 ls s3://idol-fansite-dev-db-dumps-700918785224/pg_dump/2026/10/21/
aws s3 cp s3://idol-fansite-dev-db-dumps-700918785224/pg_dump/2026/10/21/<file>.dump .

# EC2 上で (別 DB に復元される。本番 DB は触らない)
bash /home/ec2-user/app/deploy/restore-db-dump.sh /tmp/<file>.dump
#  → idol_fansite_restore_YYYYMMDDHHMM が作成され、テーブルごとの行数が表示される

# 特定テーブルだけ取り出す例
pg_restore --data-only --table=orders -f orders.sql /tmp/<file>.dump
```

### 本番への切り替え (A/B で新インスタンスに復元した場合)

1. メンテナンスモードを ON (スーパー管理者画面)
2. 復元したインスタンスのデータを確認
3. Secrets Manager / `.env.production` の `DATABASE_URL` のホストを新インスタンスに変更
   → `REFRESH_ENV=1 bash deploy/deploy.sh` 等で反映、`pm2 reload all`
4. Stripe Webhook Lambda の環境変数も更新 (CDK の DbHost を変更して `*-webhook` を再デプロイ)
5. メンテナンスモードを OFF

---

## 6. 定期的にやること

### 6-1. 復元テスト (毎月) — 基本は自動

`*-backup` スタックに **AWS Backup Restore Testing** を組み込んであるため、
**毎月 2 日 10:00 (JST)** に自動で以下が行われます:

1. 直近 7 日以内の最新バックアップから一時 DB (`awsbackup-restore-test-...`, db.t3.micro) を復元
2. 復元が完了したら 1 時間後に自動削除 (課金は月数十円程度)
3. 結果を **yotamatsumaru@gmail.com** にメール通知 (`AWS Backup 復元ジョブ: COMPLETED` / `FAILED`)

**あなたがやること: 毎月 2〜3 日に「COMPLETED」のメールが届いているか確認するだけ。**
届いていなければ:

```bash
bash deploy/security-ops.sh backup-status     # バックアップ / コピー / 復元ジョブの結果一覧
```

#### 手動で今すぐ復元テストしたい (初回デプロイ後に 1 度やるのがおすすめ)

```bash
bash deploy/security-ops.sh restore-test-now
# → 表示されたコマンドで中身 (行数) を確認 → 最後に表示される delete コマンドで削除
```

#### pg_dump 側の復元テスト (四半期に 1 回程度)

自動テストは AWS Backup のスナップショットが対象です。pg_dump も戻せるかを確認します:

```bash
# PC で最新ダンプを取得
aws s3 ls s3://idol-fansite-dev-db-dumps-700918785224/pg_dump/ --recursive | tail -1
aws s3 cp s3://idol-fansite-dev-db-dumps-700918785224/pg_dump/<パス>.dump ./latest.dump

# EC2 へ渡して (SSM 経由で S3 の一時場所を使う等) 別 DB に復元 → 行数確認 → DROP
bash /home/ec2-user/app/deploy/restore-db-dump.sh /tmp/latest.dump
```

この時、ダンプを 1 つ **AWS の外** (暗号化した外付けディスク等) にも保管しておくと、
AWS アカウントそのものを失った場合の最後の備えになります。

#### 復元テストが失敗したら

1. メール本文の「メッセージ」を確認 (よくある原因: サブネット / SG の変更、インスタンスクラス非対応)
2. `bash deploy/security-ops.sh backup-status` で直近のバックアップ自体が COMPLETED か確認
3. バックアップ自体が失敗していれば、RDS が停止していないか / Vault Lock の保持日数制約 (7〜400 日) に
   違反する設定変更をしていないかを確認

### 6-2. Vault Lock を compliance モードにする (運用が安定してから)

**目安:** 次の 3 つがすべて満たされてから。

- [ ] 毎月の自動復元テストが 2 回以上連続で COMPLETED
- [ ] `backup-status` でバックアップ・大阪コピーが毎日成功している
- [ ] 保持期間 (日次 35 日 / 月次 365 日 / pg_dump 30 日) を今後変える予定が無い

> ⚠️ **compliance にすると、72 時間後からは AWS ルートユーザーでも解除・保持期間の短縮・
> 復旧ポイントの削除ができなくなります。** 月次バックアップは最長 1 年間、削除も課金停止もできません
> (目安: 月数百〜1,500 円程度が確定的に続く)。その代わり、アカウントを完全に乗っ取られても
> バックアップは消されません。

#### 手順

1. `infra/cdk.json` を変更:
   ```diff
   -    "backupVaultLockMode": "governance",
   +    "backupVaultLockMode": "compliance",
   ```
2. デプロイ (東京・大阪の両 Vault と pg_dump バケットに適用):
   ```bash
   cd infra
   npx cdk diff '*-backup-copy' '*-backup' --context domainName=reirie.com   # 変更内容を確認
   pnpm run deploy:backup --context domainName=reirie.com
   ```
3. 状態確認:
   ```bash
   bash deploy/security-ops.sh vault-lock-status
   # LockDate に「今から 3 日後」の日時が出ていれば猶予期間中
   ```
4. **72 時間 (LockDate) までに問題があれば取り消せます:**
   ```bash
   aws backup delete-backup-vault-lock-configuration --region ap-northeast-1 --backup-vault-name idol-fansite-dev-vault-primary
   aws backup delete-backup-vault-lock-configuration --region ap-northeast-3 --backup-vault-name idol-fansite-dev-vault-copy
   # その後 cdk.json を governance に戻して再デプロイ
   ```
5. LockDate を過ぎたら確定。以降 `vault-lock-status` で `Locked: True` / LockDate が過去になります。

> 補足: pg_dump バケットの Object Lock も同時に COMPLIANCE になりますが、こちらは
> 「これから保存されるダンプ」に適用されます (既存ダンプは保存時のモードのまま)。
> 保持期間は 30 日なので影響は限定的です。

### 6-3. その他の定期作業

| 頻度 | 作業 |
|---|---|
| 毎月 2〜3 日 | 自動復元テストの COMPLETED メールを確認 |
| 毎月 | `bash deploy/security-ops.sh waf-report 30` で攻撃傾向をざっと確認 |
| 四半期 | pg_dump の復元テスト + AWS 外への退避 |
| 四半期 | IAM ユーザー棚卸し: 不要なアクセスキー削除、全員 MFA 必須、ルートユーザーは MFA + 封印 |

### AWS アカウント側で推奨する追加設定 (CDK 外・コンソールで 1 回)

- **ルートユーザーの MFA** (ハードウェアキー推奨) とアクセスキー削除
- **IAM Identity Center or IAM ユーザー全員に MFA**、`AdministratorAccess` の常用をやめる
- **GuardDuty 有効化** (不審な API 呼び出し・暗号資産マイニング・認証情報の不正利用を検知。月数百円〜)
- **CloudTrail** (管理イベントは既定で 90 日保存。長期保存するなら証跡を作成)
- **AWS Budgets** で請求アラート (乗っ取られた際のリソース大量起動に早く気付ける)
- GitHub: `main` のブランチ保護、2FA 必須、Dependabot alerts 有効化

---

## 7. 設定値 (cdk.json の context)

| key | 既定 | 説明 |
|---|---|---|
| `destroyOnRemove` | `false` | `true` だと RDS 削除保護 OFF / S3 自動削除 (使い捨て環境専用) |
| `rdsBackupRetentionDays` | 14 (prod 35) | PITR 保持日数 (1〜35) |
| `backupEnabled` | `!destroyOnRemove` | AWS Backup / pg_dump バケットを作るか |
| `backupCopyRegion` | `ap-northeast-3` | 別リージョンコピー先。`""` でコピー無効 |
| `backupVaultLockMode` | `governance` | `compliance` で誰も解除不可 |
| `backupDumpRetentionDays` | 30 | pg_dump の Object Lock 保持日数 |
| `backupRestoreTestEnabled` | `true` | 毎月の自動復元テスト |
| `wafEnabled` | `true` | WAF を作るか (`domainName` 指定時のみ) |
| `wafManagedRulesAction` | `count` | マネージドルールの動作 (`count` / `block`) |
| `wafAuthRateLimit` | 100 | 認証 API の 5 分あたり上限 / IP |
| `wafGlobalRateLimit` | 3000 | 全体の 5 分あたり上限 / IP |
| `wafGlobalRateAction` | `count` | 全体レート制限の動作 |
| `cloudFrontPrefixListId` | (なし) | 指定すると EC2:443 を CloudFront のみに制限 |

### 費用の目安 (月額・東京)

| 項目 | 目安 |
|---|---|
| AWS Backup (20GB DB × 日次35世代 + 月次12世代、増分) + 大阪コピー + 転送 | 数百円〜1,500 円程度 |
| pg_dump 保存 (数十 MB × 30 世代) | 数円〜数十円 |
| 自動復元テスト (db.t3.micro を月 1 回 1〜2 時間) | 数十円 |
| WAF (Web ACL 1 + ルール 6 + 100 万リクエストあたり $0.60) | 約 $11 + リクエスト課金 (≒ 2,000 円前後) |
| S3 バージョニングの旧版保存 | 更新頻度次第 (14〜30 日で自動削除) |
