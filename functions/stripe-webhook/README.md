# Stripe Webhook Lambda

EC2 (Next.js) とは独立して稼働する Stripe Webhook 受信専用 Lambda。
EC2 障害・デプロイ中でも Webhook を取りこぼさないよう分離配置している。

## 配信経路

```
Stripe → Lambda Function URL → handler → RDS PostgreSQL
                                       ↘ (任意) SES 通知
```

- **Function URL** を直接 Stripe の Webhook エンドポイントに設定
- API Gateway は不要 (1経路でレイテンシ最小化)
- IAM 認証は無効 (Stripe 署名検証で代替)

## 取り扱いイベント

| event.type | 処理内容 |
|---|---|
| `checkout.session.completed` (mode=subscription) | 初回サブスク作成 (Subscription 行を upsert) |
| `checkout.session.completed` (mode=payment) | EC 注文を PAID に遷移 |
| `customer.subscription.created/updated` | プラン・期間を同期 |
| `customer.subscription.deleted` | CANCELED に変更 |
| `invoice.payment_succeeded` | Payment 行を SUCCEEDED で記録 |
| `invoice.payment_failed` | Payment 行を FAILED で記録 |
| `payment_intent.succeeded` | EC 決済成功時のフォールバック (idempotent) |
| `payment_intent.payment_failed` | EC 決済失敗時の状態更新 |

## 本番 / テストモードの切り替え (A-1 方式)

この Lambda はプラン・ランク (Subscription) の反映を担当するため、
**管理画面 (SUPER_ADMIN) の Stripe テスト/本番トグルに追従する**ようにした。

- 有効モードは `AppSetting` テーブルの `stripe.mode` (`LIVE` / `TEST`) を読む
  (Web アプリと同じ設定を共有)。
- `TEST` かつ `stripe.testCredentials` に `secretKey` / `webhookSecret` が
  揃っている場合のみテストキーを使う。それ以外は SSM の**本番キーにフォールバック**
  (フェイルセーフ性を維持)。
- モード解決はイベントごとに DB を読む (warm start でもトグルが即反映される)。
- Price ID も `TEST` 時は `stripe.testCredentials` の値を優先する
  (未設定分は `STRIPE_PRICE_*` 環境変数へフォールバック)。
- CloudWatch Logs の `[stripe-webhook] processed mode=TEST/LIVE ...` で
  どちらで処理したか確認できる。

> **⚠️ 重要 (Stripe Dashboard 側の設定が別途必要):**
> テストモードでプラン加入を検証するには、**Stripe Dashboard の「テストモード」側**で
> この Lambda の Function URL 宛に Webhook エンドポイントを追加し
> (`customer.subscription.*` / `invoice.*` / `checkout.session.completed` を購読)、
> そこで発行される**テスト用 Webhook Secret (`whsec_...`)** を管理画面の
> テスト資格情報 `webhookSecret` に入力すること。
> これがないと Lambda はテストイベントを受信できない (署名検証以前に届かない)。
>
> 検証が終わったら管理画面のトグルを **本番 (LIVE)** に戻すこと。テスト中は
> 本番のサブスク Webhook がテストキーで検証されて失敗するため、本物の課金イベントを
> 取りこぼすリスクがある (Stripe は最大3日リトライするが、長時間の放置は避ける)。

## 冪等性 (Idempotency)

- 受信した event の `event.id` を `stripe_webhook_events` テーブルに upsert で記録
- 既存レコードがあれば早期 return → 多重実行を抑止
- DB 変更は基本 `upsert` (where に Stripe IDを指定) で副作用を冪等に

## 環境変数

- `DATABASE_URL` — RDS への接続文字列
- `STRIPE_SECRET_KEY` — Stripe API キー
- `STRIPE_WEBHOOK_SECRET` — Webhook 署名検証用シークレット
- `STRIPE_PRICE_*` — プラン判定用 (任意, ない場合は item の price.id をそのまま記録)

## ローカル動作確認

```bash
# 1. Stripe CLI で localhost に転送
stripe listen --forward-to http://localhost:9000/

# 2. ローカル Lambda エミュレータ (sam local もしくは esbuild + 手動) で起動
pnpm --filter @idol/stripe-webhook build
node -e "
  const { handler } = require('./dist/index.js');
  // ...AWS Lambda Function URL イベントを擬似入力
"

# 3. テスト用イベント発火
stripe trigger checkout.session.completed
stripe trigger invoice.payment_succeeded
```

## デプロイ

CDK (`infra/lib/webhook-stack.ts`) で `lambda.Function` + `FunctionUrl` を定義。
ZIP パッケージは `pnpm run build:zip` で生成し、CDK の `Code.fromAsset()` で参照。

### ⚠️ Prisma エンジンの同梱 (必須)

この Lambda は `@idol/db` (Prisma) を使うため、**Linux 用クエリエンジン**
`libquery_engine-rhel-openssl-3.0.x.so.node` を ZIP に含めないと、
実行時に `PrismaClientInitializationError: could not locate the Query Engine`
が発生し、全リクエストが 502 になる。

対策は以下 3 点で、`pnpm run build:zip` と `src/db.ts` に組み込み済み:

1. `packages/db/prisma/schema.prisma` の `generator.binaryTargets` に
   `"rhel-openssl-3.0.x"` を含める → `pnpm db:generate` で Linux エンジンが生成される。
2. ビルド後に `scripts/copy-prisma-engine.cjs` がそのエンジンを
   `dist/.prisma/client/` (主) と `dist/` 直下 (副) の **両方**へコピーし、
   `scripts/make-zip.cjs` が両方を ZIP に格納する (計 4 エントリ)。
3. **`src/db.ts` が `@idol/db` (= PrismaClient の生成) を読み込む前に、
   環境変数 `PRISMA_QUERY_ENGINE_LIBRARY` を同梱エンジンの絶対パスに設定する。**
   これが最重要。`esbuild --bundle --minify` は Prisma のエンジン探索ロジックを
   壊し、ビルドマシン (Windows) の絶対パスをバンドルに焼き込んでしまうため、
   ZIP にエンジンを入れるだけでは `/var/task` を探索してくれない。
   `db.ts` は `LAMBDA_TASK_ROOT` (通常 `/var/task`) 配下の
   `.prisma/client/…so.node` → ルート `…so.node` の順で実在するパスを検出し、
   `PRISMA_QUERY_ENGINE_LIBRARY` に設定してから PrismaClient を `require` する。

> ❌ `Compress-Archive -Path index.js, index.js.map` のように JS だけを手動 ZIP すると
> エンジンが漏れて 502 になる。必ず `pnpm run build:zip` (または `build:full` → `make-zip`) を使うこと。
> ❌ ZIP にエンジンを入れても `db.ts` の `PRISMA_QUERY_ENGINE_LIBRARY` 設定が無いと、
> minify 済みバンドルは Windows パスを探し続けて 502 になる (実際に発生した事象)。
>
> 💡 保険として Lambda の環境変数に直接
> `PRISMA_QUERY_ENGINE_LIBRARY=/var/task/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node`
> を設定してもよい (コード側は環境変数が既にあればそれを尊重する)。

### 手動デプロイ手順 (Windows PowerShell)

GitHub Actions は main で稼働していないため手動デプロイ。プロジェクトルートで:

```powershell
# 1. 最新を取得
git pull

# 2. 依存インストール & Prisma クライアント生成 (Linux エンジンを含む)
pnpm install
pnpm db:generate

# 3. ビルド + エンジン同梱 + ZIP 作成 (この 1 コマンドで全部やる)
pnpm --filter @idol/stripe-webhook build:zip

# 4. ZIP の中身を確認 (4 エントリが必須:
#    index.js / index.js.map / .prisma\client\*.so.node / ルート *.so.node)
#    PowerShell:
Expand-Archive -Path functions\stripe-webhook\dist\function.zip -DestinationPath functions\stripe-webhook\dist\_check -Force
Get-ChildItem -Recurse functions\stripe-webhook\dist\_check | Select-Object FullName
Remove-Item -Recurse functions\stripe-webhook\dist\_check

# 5. Lambda を更新
aws lambda update-function-code `
  --function-name idol-fansite-dev-stripe-webhook `
  --zip-file fileb://functions/stripe-webhook/dist/function.zip `
  --region ap-northeast-1 `
  --publish
```

デプロイ後、CloudWatch Logs で以下を確認する:

- INIT 時に `[stripe-webhook] Prisma engine を検出: /var/task/.prisma/client/…so.node`
  が出る (= エンジンパス解決に成功)。
- Stripe テストイベント再送 → `[stripe-webhook] processed mode=TEST ...` (Status 200)。
- `PrismaClientInitializationError` が消えていること。
