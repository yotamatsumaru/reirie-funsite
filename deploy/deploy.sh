#!/bin/bash
# =====================================================================
# EC2 上での再デプロイ用スクリプト
#   SSM Run Command や git pull 後に手動で叩く
#
#   環境変数:
#     APP_BRANCH (default: main) - チェックアウトするブランチ
#
#   このスクリプトが面倒を見る "ハマりどころ":
#     1. DATABASE_URL 等の env を .env.production から安全に読み込む
#        (DB パスワードに } ~ ) ; & ! などシェルのメタ文字が含まれるため、
#         単純な `source .env.production` では代入が壊れる。PM2 が使う
#         ecosystem.config.js の専用パーサ経由で取り出す)
#     2. Next.js standalone build の静的ファイルを standalone 配下へコピー
#        (output:'standalone' は server.js だけでは .next/static と public を
#         配信しない。コピーし忘れると CSS/JS が 404 になり画面が崩れる)
#     3. pm2 reload が "Process not found" で失敗するケースのフォールバック
#        (インスタンス再起動等で pm2 のプロセスが壊れていると reload は失敗する。
#         その場合は delete -> start で確実に立て直す)
# =====================================================================
set -euo pipefail

APP_DIR="/home/ec2-user/app"
APP_BRANCH="${APP_BRANCH:-main}"
ECOSYSTEM="$APP_DIR/deploy/ecosystem.config.js"
WEB_DIR="$APP_DIR/apps/web"
STANDALONE_WEB_DIR="$WEB_DIR/.next/standalone/apps/web"

cd "$APP_DIR"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

# ---------------------------------------------------------------------
# 0. .env.production を ecosystem.config.js 経由で読み込み export する
#    (source では特殊文字を含むパスワードが壊れるため node パーサを使う)
# ---------------------------------------------------------------------
echo "[deploy] loading env from ecosystem.config.js..."
if [ -f "$ECOSYSTEM" ]; then
  # ecosystem.config.js の apps[0].env を 1 行ずつ `KEY\tVALUE` で吐き出し、
  # bash 側で安全に export する (値に改行が無い前提。PEM 等の複数行値は
  # PM2 が直接渡すのでここでは skip して問題ない)
  while IFS=$'\t' read -r k v; do
    [ -z "$k" ] && continue
    # NODE_ENV/PORT/HOSTNAME は実行時に PM2 が固定値で上書きするので不要
    case "$k" in
      NODE_ENV|PORT|HOSTNAME) continue ;;
    esac
    export "$k=$v"
  done < <(node -e '
    const c = require(process.argv[1]);
    const e = (c.apps && c.apps[0] && c.apps[0].env) || {};
    for (const k of Object.keys(e)) {
      const v = String(e[k]);
      // 値に改行を含むもの (PEM 秘密鍵など) は migrate/build に不要なので除外
      if (v.includes("\n")) continue;
      process.stdout.write(k + "\t" + v + "\n");
    }
  ' "$ECOSYSTEM" 2>/dev/null)

  if [ -n "${DATABASE_URL:-}" ]; then
    echo "[deploy] env loaded (DATABASE_URL length: ${#DATABASE_URL})"
  else
    echo "[deploy][WARN] DATABASE_URL is empty after loading env" >&2
  fi
else
  echo "[deploy][WARN] $ECOSYSTEM not found; relying on existing environment" >&2
fi

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

# ---------------------------------------------------------------------
# build 後: standalone 配下に静的ファイルをコピー
#   output:'standalone' の server.js は .next/static と public を
#   自前で配信しないため、明示的にコピーしないと CSS/JS が 404 になる。
# ---------------------------------------------------------------------
echo "[deploy] copying static assets into standalone..."
if [ -d "$STANDALONE_WEB_DIR" ]; then
  # .next/static
  if [ -d "$WEB_DIR/.next/static" ]; then
    rm -rf "$STANDALONE_WEB_DIR/.next/static"
    mkdir -p "$STANDALONE_WEB_DIR/.next"
    cp -r "$WEB_DIR/.next/static" "$STANDALONE_WEB_DIR/.next/static"
    echo "[deploy]   -> .next/static copied"
  else
    echo "[deploy][WARN]   $WEB_DIR/.next/static not found" >&2
  fi

  # public (存在する場合のみ)
  if [ -d "$WEB_DIR/public" ]; then
    rm -rf "$STANDALONE_WEB_DIR/public"
    cp -r "$WEB_DIR/public" "$STANDALONE_WEB_DIR/public"
    echo "[deploy]   -> public copied"
  fi
else
  echo "[deploy][WARN] standalone dir not found: $STANDALONE_WEB_DIR" >&2
fi

# ---------------------------------------------------------------------
# pm2: reload を試み、失敗 (プロセス未登録/破損) したら delete -> start
# ---------------------------------------------------------------------
echo "[deploy] pm2 reload (graceful)..."
if pm2 reload "$ECOSYSTEM" --update-env; then
  echo "[deploy] pm2 reload succeeded"
else
  echo "[deploy][WARN] pm2 reload failed; falling back to delete + start" >&2
  pm2 delete web 2>/dev/null || true
  pm2 start "$ECOSYSTEM"
fi

# 再起動後も自動復帰するよう保存
pm2 save

echo "[deploy] done."
pm2 status
