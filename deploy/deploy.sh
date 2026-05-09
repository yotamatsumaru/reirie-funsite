#!/bin/bash
# =====================================================================
# EC2 上での再デプロイ用スクリプト
#   SSM Run Command や git pull 後に手動で叩く
# =====================================================================
set -euo pipefail

APP_DIR="/home/ec2-user/app"
cd "$APP_DIR"

export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"

echo "[deploy] git pull..."
git fetch --all
git checkout main
git pull --ff-only

echo "[deploy] pnpm install..."
pnpm install --frozen-lockfile

echo "[deploy] prisma migrate..."
pnpm --filter @idol/db prisma:migrate:deploy

echo "[deploy] build..."
pnpm --filter @idol/web build

echo "[deploy] pm2 reload..."
pm2 reload deploy/ecosystem.config.js --update-env

echo "[deploy] done."
pm2 status
