#!/bin/bash
# =====================================================================
# .env.production の Stripe / 動画エンコード設定を
# SSM Parameter Store から再生成する
#
#   目的:
#     SSM の Stripe パラメータ (secret-key / publishable-key /
#     webhook-secret / price/*) および動画エンコード関連
#     (mediaconvert/role-arn, cloudfront/*, cron/secret) を更新したあと、
#     EC2 上の .env.production に確実に反映するためのスクリプト。
#
#     動画エンコードは MEDIACONVERT_ROLE_ARN が空だと管理画面が
#     「MediaConvert が未設定です」のままになる。CDK でロールを
#     作成しても既存インスタンスの .env.production は自動更新されない
#     ため、本スクリプトで反映する。
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

# =====================================================================
# 動画エンコード / 配信 (MediaConvert + CloudFront) 設定
# ---------------------------------------------------------------------
#   MEDIACONVERT_ROLE_ARN     : CDK StorageStack が作成したロール ARN
#   S3_MEDIA_OUTPUT_BUCKET    : HLS 出力先 (CloudFront 動画オリジン)
#   MEDIACONVERT_OUTPUT_PREFIX: HLS 出力プレフィックス (既定 hls)
#   CLOUDFRONT_VIDEO_DOMAIN   : 署名付き URL のドメイン
#   CLOUDFRONT_KEY_PAIR_ID / CLOUDFRONT_PRIVATE_KEY : 署名鍵
#   CRON_SECRET               : 完了通知 Lambda との共有シークレット
# =====================================================================
echo "[regenerate-env] fetching video encoding settings from SSM..."

MEDIACONVERT_ROLE_ARN=$(ssm_get "${SSM_BASE}/mediaconvert/role-arn")
MEDIACONVERT_OUTPUT_PREFIX=$(ssm_get "${SSM_BASE}/mediaconvert/output-prefix")
MEDIACONVERT_QUEUE_ARN=$(ssm_get "${SSM_BASE}/mediaconvert/queue-arn")
S3_MEDIA_OUTPUT_BUCKET=$(ssm_get "${SSM_BASE}/s3/media-output-bucket")
CLOUDFRONT_VIDEO_DOMAIN=$(ssm_get "${SSM_BASE}/cloudfront/video-domain")
CLOUDFRONT_ASSET_DOMAIN=$(ssm_get "${SSM_BASE}/cloudfront/asset-domain")
CLOUDFRONT_KEY_PAIR_ID=$(ssm_get "${SSM_BASE}/cloudfront/key-pair-id")
CLOUDFRONT_PRIVATE_KEY=$(ssm_get "${SSM_BASE}/cloudfront/private-key")
CRON_SECRET=$(ssm_get "${SSM_BASE}/cron/secret")

set_env_var MEDIACONVERT_ROLE_ARN "$MEDIACONVERT_ROLE_ARN"
set_env_var MEDIACONVERT_OUTPUT_PREFIX "$MEDIACONVERT_OUTPUT_PREFIX"
set_env_var MEDIACONVERT_QUEUE_ARN "$MEDIACONVERT_QUEUE_ARN"
set_env_var S3_MEDIA_OUTPUT_BUCKET "$S3_MEDIA_OUTPUT_BUCKET"
set_env_var CLOUDFRONT_VIDEO_DOMAIN "$CLOUDFRONT_VIDEO_DOMAIN"
set_env_var CLOUDFRONT_ASSET_DOMAIN "$CLOUDFRONT_ASSET_DOMAIN"
set_env_var CLOUDFRONT_KEY_PAIR_ID "$CLOUDFRONT_KEY_PAIR_ID"
# 秘密鍵は改行を含むため、値をダブルクォートで囲んだ形で書き込む必要がある。
# set_env_var は 1 行前提なので、ここだけ専用処理にする。
if [ -n "$CLOUDFRONT_PRIVATE_KEY" ]; then
  tmp="$(mktemp)"
  grep -v -E '^CLOUDFRONT_PRIVATE_KEY=' "$ENV_FILE" > "$tmp" || true
  printf 'CLOUDFRONT_PRIVATE_KEY="%s"\n' "$CLOUDFRONT_PRIVATE_KEY" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
  echo "[regenerate-env]   set CLOUDFRONT_PRIVATE_KEY = (masked, len=${#CLOUDFRONT_PRIVATE_KEY})"
else
  echo "[regenerate-env]   skip CLOUDFRONT_PRIVATE_KEY (SSM 値が空のため据え置き)"
fi
set_env_var CRON_SECRET "$CRON_SECRET"

# 動画エンコードに必須の値が揃っているかを最後に確認して警告する
if [ -z "$MEDIACONVERT_ROLE_ARN" ]; then
  echo "[regenerate-env][WARN] MEDIACONVERT_ROLE_ARN が SSM に未登録です。" >&2
  echo "[regenerate-env][WARN]   → infra を deploy し ${SSM_BASE}/mediaconvert/role-arn を作成してください。" >&2
  echo "[regenerate-env][WARN]   → 未設定のままだと管理画面で「MediaConvert が未設定です」と表示されます。" >&2
fi
if [ -z "$CLOUDFRONT_KEY_PAIR_ID" ] || [ -z "$CLOUDFRONT_PRIVATE_KEY" ]; then
  echo "[regenerate-env][WARN] CloudFront 署名鍵が未登録です。エンコードは可能ですが再生できません。" >&2
fi

# パーミッションを 600 に維持 (秘密鍵を含むため)
chmod 600 "$ENV_FILE" 2>/dev/null || true

echo "[regenerate-env] done. Stripe / 動画エンコード設定を .env.production に反映しました。"
echo "[regenerate-env] 反映を有効化するには PM2 の再起動が必要です:"
echo "[regenerate-env]   bash /home/ec2-user/app/deploy/deploy.sh"
