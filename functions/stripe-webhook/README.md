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
