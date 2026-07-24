#!/bin/bash
# =====================================================================
# .env.production の Stripe 設定を SSM Parameter Store から再生成する
#
#   目的:
#     SSM の Stripe パラメータ (secret-key / publishable-key /
#     webhook-secret / price/*) を更新したあと、EC2 上の
#     .env.production に確実に反映するためのスクリプト。
#
#     従来 .env.production を SSM から生成するのは user-data.sh
#     (インスタンス初回起動時) だけで、SSM を後から更新しても
#     deploy.sh では反映されず「SSM は直したのにサーバーエラーが
#     直らない」というハマりが起きていた。本スクリプトはそこだけを
#     安全に埋めるために切り出したもの。
#
#   特徴:
#     - DB 認証情報など複雑な値には一切触らない (Stripe 関連のみ更新)。
#     - 冪等: 既存行があれば置換、無ければ追記。何度実行しても同じ結果。
#     - SSM から取得できなかった (空) 値では上書きしない
#       (取得失敗で本番の鍵を空に飛ばす事故を防ぐ)。
#
#   環境変数 (省略時は下記デフォルト / .env.production から自動推定):
#     APP_NAME  (default: idol-fansite)
#     ENV_NAME  (default: dev)
#     AWS_REGION(default: .env.production の AWS_REGION → ap-northeast-1)
#     ENV_FILE  (default: /home/ec2-user/app/.env.production)
#
#   使い方 (EC2 上):
#     bash /home/ec2-user/app/deploy/regenerate-env.sh
#     APP_NAME=idol-fansite ENV_NAME=dev bash .../regenerate-env.sh
# =====================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-/home/ec2-user/app/.env.production}"
APP_NAME="${APP_NAME:-idol-fansite}"
ENV_NAME="${ENV_NAME:-dev}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[regenerate-env][ERROR] env file not found: $ENV_FILE" >&2
  echo "[regenerate-env][ERROR] 先に user-data.sh での初回生成が必要です。" >&2
  exit 1
fi

# AWS_REGION は引数 > 既存 .env.production > デフォルト の優先順で決める
if [ -z "${AWS_REGION:-}" ]; then
  AWS_REGION=$(grep -E '^AWS_REGION=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)
fi
AWS_REGION="${AWS_REGION:-ap-northeast-1}"

SSM_BASE="/${APP_NAME}/${ENV_NAME}"
echo "[regenerate-env] SSM base: $SSM_BASE (region: $AWS_REGION)"
echo "[regenerate-env] env file: $ENV_FILE"

# SSM から 1 パラメータを取得 (取得失敗/未登録なら空文字)
ssm_get() {
  aws ssm get-parameter \
    --name "$1" \
    --with-decryption \
    --region "$AWS_REGION" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || echo ""
}

# .env.production の KEY=VALUE を安全に置換/追記する (冪等)。
#   - 値が空のときは何もしない (既存値を消さない安全策)。
#   - sed の区切り/エスケープ事故を避けるため、行削除 + 追記で実現する。
set_env_var() {
  local key="$1"
  local val="$2"
  if [ -z "$val" ]; then
    echo "[regenerate-env]   skip $key (SSM 値が空のため据え置き)"
    return 0
  fi
  # 既存行を削除 (KEY= で始まる行)
  local tmp
  tmp="$(mktemp)"
  grep -v -E "^${key}=" "$ENV_FILE" > "$tmp" || true
  # 追記 (値はそのまま。Stripe のキー/ID には空白や改行は含まれない)
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
  # 値はログに出さない (秘密鍵保護)。先頭数文字だけ出す。
  local masked="${val:0:8}"
  echo "[regenerate-env]   set $key = ${masked}… (len=${#val})"
}

echo "[regenerate-env] fetching Stripe settings from SSM..."

STRIPE_SECRET_KEY=$(ssm_get "${SSM_BASE}/stripe/secret-key")
STRIPE_PUBLISHABLE_KEY=$(ssm_get "${SSM_BASE}/stripe/publishable-key")
STRIPE_WEBHOOK_SECRET=$(ssm_get "${SSM_BASE}/stripe/webhook-secret")
STRIPE_PRICE_STANDARD_MONTHLY=$(ssm_get "${SSM_BASE}/stripe/price/standard-monthly")
STRIPE_PRICE_STANDARD_YEARLY=$(ssm_get "${SSM_BASE}/stripe/price/standard-yearly")
STRIPE_PRICE_PREMIUM_MONTHLY=$(ssm_get "${SSM_BASE}/stripe/price/premium-monthly")
STRIPE_PRICE_PREMIUM_YEARLY=$(ssm_get "${SSM_BASE}/stripe/price/premium-yearly")

# 簡易バリデーション: プレースホルダ (★) や DUMMY が混入していたら警告
warn_if_suspicious() {
  local key="$1" val="$2"
  case "$val" in
    *"★"*|*DUMMY*|*"あなた"*)
      echo "[regenerate-env][WARN] $key に不正な値 (プレースホルダ/DUMMY) が含まれています: 実際の値に修正してください。" >&2
      ;;
  esac
}
warn_if_suspicious STRIPE_SECRET_KEY "$STRIPE_SECRET_KEY"
warn_if_suspicious STRIPE_PRICE_STANDARD_MONTHLY "$STRIPE_PRICE_STANDARD_MONTHLY"
warn_if_suspicious STRIPE_PRICE_PREMIUM_YEARLY "$STRIPE_PRICE_PREMIUM_YEARLY"

set_env_var STRIPE_SECRET_KEY "$STRIPE_SECRET_KEY"
set_env_var STRIPE_PUBLISHABLE_KEY "$STRIPE_PUBLISHABLE_KEY"
# フロント (ブラウザ) が使う公開鍵は NEXT_PUBLIC_ 版にも反映する
set_env_var NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY "$STRIPE_PUBLISHABLE_KEY"
set_env_var STRIPE_WEBHOOK_SECRET "$STRIPE_WEBHOOK_SECRET"
set_env_var STRIPE_PRICE_STANDARD_MONTHLY "$STRIPE_PRICE_STANDARD_MONTHLY"
set_env_var STRIPE_PRICE_STANDARD_YEARLY "$STRIPE_PRICE_STANDARD_YEARLY"
set_env_var STRIPE_PRICE_PREMIUM_MONTHLY "$STRIPE_PRICE_PREMIUM_MONTHLY"
set_env_var STRIPE_PRICE_PREMIUM_YEARLY "$STRIPE_PRICE_PREMIUM_YEARLY"

# パーミッションを 600 に維持 (秘密鍵を含むため)
chmod 600 "$ENV_FILE" 2>/dev/null || true

echo "[regenerate-env] done. Stripe 設定を .env.production に反映しました。"
echo "[regenerate-env] 反映を有効化するには PM2 の再起動が必要です:"
echo "[regenerate-env]   bash /home/ec2-user/app/deploy/deploy.sh"
