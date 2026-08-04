# reirie-funsite

アイドルファンサイト (idol fan site) — member-based fan club platform with EC functionality and Lawson Ticket integration.

## 📂 主要ドキュメント

| Doc | 内容 |
|---|---|
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | **AWS EC2 への本番デプロイ手順書 (dev環境)** |
| [`infra/README.md`](infra/README.md) | AWS CDK スタック設計 (8スタック構成) |
| [`docs/VIDEO_ENCODING.md`](docs/VIDEO_ENCODING.md) | **動画エンコード (MediaConvert + HLS) セットアップ手順** |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | 運用 / 障害対応 Runbook |
| [`docs/openapi.yaml`](docs/openapi.yaml) | REST API 仕様 |
| [`.env.example`](.env.example) | 環境変数テンプレート |

## 🚀 クイックスタート (ローカル開発)

```bash
# 1. 依存インストール
pnpm install

# 2. .env.local を準備 (デモモードでDB不要)
cat > apps/web/.env.local <<EOF
DEMO_MODE=1
NEXT_PUBLIC_DEMO_MODE=1
AUTH_SECRET=demo-insecure-secret-32bytes-padding-aaaaaaaa
AUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true
EOF

# 3. 起動
pnpm --filter @idol/web dev
# → http://localhost:3000

# デモログイン:
#   super@example.com  / 任意パスワード  (SUPER_ADMIN)
#   admin@example.com  / 任意パスワード  (ADMIN)
#   demo@example.com   / 任意パスワード  (USER)
```

## 🔨 技術スタック

- **Next.js 16** App Router + React 19 + TypeScript 5.9
- **Prisma 5.22** + PostgreSQL 15
- **Auth.js v5** (Credentials)
- **Tailwind 4** + Zustand 5 + Zod 4
- **monorepo**: pnpm + Turbo (apps/web, packages/{db,shared}, functions/stripe-webhook, infra)
- **デプロイ先**: AWS EC2 (Amazon Linux 2023) + PM2 cluster mode + nginx reverse proxy

詳細は `genspark_ai_developer` ブランチを参照。
