# GitHub Actions Workflows

これらのワークフローファイル (`ci.yml`, `deploy.yml`) は本来 `.github/workflows/` 配下に配置すべきものですが、**Genspark の GitHub App が `workflows` 権限を持たないため、自動 push できません**。

リポジトリ管理者 (= あなた) が **以下のいずれかの方法で配置** してください。

---

## 方法1: GitHub Web UI で追加 (最も簡単)

1. リポジトリページから `.github/workflows/` ディレクトリを作成
2. このディレクトリの `ci.yml` の中身をコピー & 貼り付けて `.github/workflows/ci.yml` として commit
3. 同様に `deploy.yml` も配置

## 方法2: ローカルから追加 (要 `workflow` scope の PAT)

```bash
# 1. PAT を発行 (https://github.com/settings/tokens で "workflow" スコープを付ける)
export GH_TOKEN=ghp_xxxxxxxxxxxx

# 2. ローカルにクローン
git clone https://x-access-token:${GH_TOKEN}@github.com/yotamatsumaru/reirie-funsite.git
cd reirie-funsite
git checkout genspark_ai_developer

# 3. workflows を配置
mkdir -p .github/workflows
cp docs/github-workflows/ci.yml .github/workflows/ci.yml
cp docs/github-workflows/deploy.yml .github/workflows/deploy.yml

# 4. .gitignore から .github/workflows/ の行を削除
sed -i '/\.github\/workflows\//d' .gitignore

# 5. commit + push
git add .github/workflows .gitignore
git commit -m "ci: enable GitHub Actions workflows"
git push origin genspark_ai_developer
```

## 方法3: gh CLI を使う

```bash
# 認証 (workflow scope を含むトークンが必要)
gh auth login --scopes "repo,workflow"

# main にチェックアウト後、上記方法2と同じ手順
```

---

## ワークフロー概要

### ci.yml — Pull Request 時の検証

- 起動条件: `push` (main, genspark_ai_developer) / `pull_request` (main)
- ジョブ:
  - `lint-typecheck-test`: PostgreSQL 15 サービスコンテナで Prisma migrate + typecheck + test
  - `build-web`: Next.js 16 standalone build → artifact 化
  - `build-lambda`: Stripe Webhook Lambda の esbuild
  - `cdk-synth`: CDK テンプレート生成 (continue-on-error)

### deploy.yml — main push で自動デプロイ

- 起動条件: `push` (main) / `workflow_dispatch` (手動)
- ジョブ:
  - `deploy-lambda`: `aws lambda update-function-code` で Stripe Webhook 更新
  - `deploy-ec2`: SSM RunCommand で EC2 上の `deploy/deploy.sh` を実行 (git pull → migrate → build → pm2 reload)
  - `deploy-infra`: CDK deploy (workflow_dispatch で `target: infra` を指定したときのみ)
- **必要な GitHub Secrets**:
  - `AWS_DEPLOY_ROLE_ARN` — OIDC で AssumeRole する IAM Role の ARN
  - `STRIPE_WEBHOOK_FN` — Lambda 関数名 (webhook-stack の Output から取得)
- **必要な AWS リソース**: GitHub Actions OIDC Provider + IAM Role (詳細は `docs/DEPLOYMENT.md` Step 7)

---

## 配置後の確認

`.github/workflows/` 配下に置いた後、何でもいいので main に push → Actions タブで両 workflow が動くことを確認してください。
