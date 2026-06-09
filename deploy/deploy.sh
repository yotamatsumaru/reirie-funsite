#!/bin/bash
# =====================================================================
# EC2 上での再デプロイ用スクリプト
#   SSM Run Command や git pull 後に手動で叩く
#
#   環境変数:
#     APP_BRANCH (default: main) - チェックアウトするブランチ
# =====================================================================
set -euo pipefail

APP_DIR="/home/ec2-user/app"
APP_BRANCH="${APP_BRANCH:-main}"

cd "$APP_DIR"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

echo "[deploy] target branch: $APP_BRANCH"
echo "[deploy] git pull..."
git fetch --all --prune
git checkout "$APP_BRANCH"
git pull --ff-only

echo "[deploy] pnpm install..."
pnpm install --frozen-lockfile

echo "[deploy] prisma generate..."
pnpm --filter @idol/db prisma:generate

echo "[deploy] prisma migrate..."
pnpm --filter @idol/db prisma:migrate:deploy

echo "[deploy] build..."
pnpm --filter @idol/web build

echo "[deploy] pm2 reload (graceful)..."
pm2 reload deploy/ecosystem.config.js --update-env

echo "[deploy] done."
pm2 status
