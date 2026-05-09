# GitHub Actions Workflows

これらのワークフローファイル (`ci.yml`, `deploy.yml`) は本来 `.github/workflows/` 配下に配置すべきものですが、GitHub App が `workflows` 権限を持たないため、リポジトリに直接プッシュできませんでした。

## 有効化手順

リポジトリ管理者が以下のいずれかの方法で `.github/workflows/` 配下にコピーしてください。

### 方法1: GitHub Web UI で追加

1. リポジトリページから `.github/workflows/` ディレクトリを作成
2. `ci.yml` と `deploy.yml` の内容をコピーしてコミット

### 方法2: ローカルから追加 (要 `workflow` scope の PAT)

```bash
git checkout genspark_ai_developer
mkdir -p .github/workflows
cp docs/github-workflows/ci.yml .github/workflows/ci.yml
cp docs/github-workflows/deploy.yml .github/workflows/deploy.yml
git add .github/workflows
git commit -m "ci: enable GitHub Actions workflows"
git push
```

## ワークフロー概要

### ci.yml
- lint / typecheck / test / build を PR ごとに実行
- PostgreSQL 15 サービスコンテナを使用
- Lambda ビルド・CDK synth も含む (cdk-synth は continue-on-error)

### deploy.yml
- main ブランチへの push で起動
- Lambda update-function-code + EC2 SSM RunCommand によるデプロイ
- AWS CDK deploy を含む
