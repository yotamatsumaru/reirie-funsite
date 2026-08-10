#!/bin/bash
# =====================================================================
# EC2 上での再デプロイ用スクリプト
#   SSM Run Command や git pull 後に手動で叩く
#
#   環境変数:
#     APP_BRANCH (default: main) - チェックアウトするブランチ
#     REFRESH_ENV (0/1, default: 0) - 1 なら SSM から .env.production の
#         Stripe 設定を再生成してからビルド/再起動する。
#         (SSM を更新したあとの反映用。--refresh-env オプションでも指定可)
#
#   使い方:
#     bash deploy.sh                 # 通常デプロイ (env は据え置き)
#     bash deploy.sh --refresh-env   # SSM から Stripe 設定を再取得して反映
#     REFRESH_ENV=1 bash deploy.sh   # 同上 (環境変数指定)
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

# --refresh-env オプション / REFRESH_ENV 環境変数の解釈
REFRESH_ENV="${REFRESH_ENV:-0}"
for arg in "$@"; do
  case "$arg" in
    --refresh-env) REFRESH_ENV=1 ;;
  esac
done

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

# ---------------------------------------------------------------------
# REFRESH_ENV=1: SSM から .env.production の Stripe 設定を再生成する。
#   git pull の "後" に実行することで、最新の regenerate-env.sh を使う。
#   build の "前" に実行することで、NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
#   などビルド時に埋め込まれる公開値も新しい値で焼き込まれる。
#   再生成後は step 0 で export 済みの env を最新値へ読み直す。
# ---------------------------------------------------------------------
if [ "$REFRESH_ENV" = "1" ]; then
  echo "[deploy] REFRESH_ENV=1: regenerating .env.production Stripe settings from SSM..."
  if [ -f "$APP_DIR/deploy/regenerate-env.sh" ]; then
    bash "$APP_DIR/deploy/regenerate-env.sh"
    # 再生成後の値を現在のシェルにも反映 (build がこの env を参照するため)
    echo "[deploy] reloading env after refresh..."
    while IFS=$'\t' read -r k v; do
      [ -z "$k" ] && continue
      case "$k" in
        NODE_ENV|PORT|HOSTNAME) continue ;;
      esac
      export "$k=$v"
    done < <(node -e '
      const c = require(process.argv[1]);
      const e = (c.apps && c.apps[0] && c.apps[0].env) || {};
      for (const k of Object.keys(e)) {
        const v = String(e[k]);
        if (v.includes("\n")) continue;
        process.stdout.write(k + "\t" + v + "\n");
      }
    ' "$ECOSYSTEM" 2>/dev/null)
  else
    echo "[deploy][WARN] regenerate-env.sh not found; skipping env refresh" >&2
  fi
fi

echo "[deploy] pnpm install..."
pnpm install --frozen-lockfile

echo "[deploy] prisma generate..."
pnpm --filter @idol/db prisma:generate

echo "[deploy] prisma migrate..."
# 【重要】マイグレーション失敗でデプロイ全体を止めない。
#   set -euo pipefail 下で `prisma migrate deploy` が失敗すると、以降の build /
#   PM2 再起動が実行されず、アプリのコード修正が本番に反映されない
#   (= 修正済みでもサーバーエラーが直らない典型的なハマり)。
#   マイグレーションが失敗しても、アプリ側は promo_until 等のカラム未適用でも
#   500 にならないよう防御実装済みなので、まずアプリを確実に更新することを優先する。
#   migrate が失敗した場合はログに大きく警告を出し、手動対応を促す。
if pnpm --filter @idol/db prisma:migrate:deploy; then
  echo "[deploy] prisma migrate: OK"
else
  echo "########################################################################"
  echo "[deploy][WARN] prisma migrate deploy が失敗しました。"
  echo "[deploy][WARN] マイグレーションはスキップし、アプリのデプロイを継続します。"
  echo "[deploy][WARN] DB スキーマの適用は手動で確認・対応してください:"
  echo "[deploy][WARN]   pnpm --filter @idol/db exec prisma migrate status"
  echo "########################################################################"
fi

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

# ---------------------------------------------------------------------
# 定期ジョブ (cron) の登録 / 更新
#   誕生日メールの自動送信トリガーなど。/etc/cron.d に書くので冪等で、
#   毎回のデプロイで実行しても重複登録されない。既存インスタンス
#   (user-data を再実行しない) にも確実に行き渡らせるためここでも実行する。
#
#   root 権限が必要なため sudo で呼ぶ。sudo が使えない/失敗しても
#   デプロイ全体は止めない (set -e 下なので || で受ける)。
# ---------------------------------------------------------------------
if [ -f "$APP_DIR/deploy/install-cron.sh" ]; then
  echo "[deploy] installing cron jobs..."
  if sudo -n APP_DIR="$APP_DIR" bash "$APP_DIR/deploy/install-cron.sh"; then
    echo "[deploy] cron jobs installed"
  else
    echo "[deploy][WARN] failed to install cron jobs (sudo 権限を確認してください)" >&2
    echo "[deploy][WARN]   手動実行: sudo bash $APP_DIR/deploy/install-cron.sh" >&2
  fi
else
  echo "[deploy][WARN] deploy/install-cron.sh not found; skipping cron setup" >&2
fi

echo "[deploy] done."
pm2 status
