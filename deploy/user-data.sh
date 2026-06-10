# =====================================================================
# EC2 (Amazon Linux 2023) UserData
#
# 注意: ここでは shebang を書かない。
#   CDK の ec2.UserData.forLinux() が自動で '#!/bin/bash' を先頭に付与する。
#   ここでもう一度 '#!/bin/bash' を書くと cloud-init が "shebang 2行" の
#   user-data として誤認し、scripts-user モジュールが sh で実行してしまう
#   (= 'set -o pipefail' が invalid option name で落ちる)。
#
# プロビジョニング内容:
#   - 基本パッケージ (git, nginx, postgresql15-client, jq 等)
#   - nvm + Node.js 20.20.0
#   - pnpm 9 + PM2
#   - CloudWatch Agent
#   - SSM Parameter Store から secrets を読み込み .env.production を生成
#   - リポジトリ clone → pnpm install --prod=false → prisma migrate → build
#   - PM2 でアプリ起動 + 自動起動登録
#
# CDK ec2-stack.ts によりプレースホルダ (__APP_NAME__ 等) は置換される
# =====================================================================

# 何があっても /var/log/user-data.log にすべてミラーする (デバッグ最優先)
exec > >(tee -a /var/log/user-data.log) 2>&1
echo "[user-data] === start at $(date -Is) ==="

set -euo pipefail

# ---- 0. プレースホルダ (CDK が置換) ----
APP_NAME="__APP_NAME__"
ENV_NAME="__ENV_NAME__"
AWS_REGION="__AWS_REGION__"
DB_HOST="__DB_HOST__"
DB_PORT="__DB_PORT__"
DB_NAME="__DB_NAME__"
DB_SECRET_ARN="__DB_SECRET_ARN__"
VIDEO_BUCKET="__VIDEO_BUCKET__"
ASSET_BUCKET="__ASSET_BUCKET__"
MEDIA_OUTPUT_BUCKET="__MEDIA_OUTPUT_BUCKET__"
APP_REPO_URL="__APP_REPO_URL__"
APP_BRANCH="__APP_BRANCH__"

APP_USER="ec2-user"
APP_DIR="/home/${APP_USER}/app"
LOG_DIR="/home/${APP_USER}/logs"
NODE_VERSION="20.20.0"
PNPM_VERSION="9.15.9"

# ---- 1. ログ集約 ----
exec > >(tee -a /var/log/user-data.log | logger -t user-data) 2>&1
echo "[user-data] start $(date -u +%FT%TZ)"

# ---- 2. 基本パッケージ ----
dnf -y update
dnf -y install \
  git tar gzip jq unzip \
  nginx \
  postgresql15 \
  amazon-cloudwatch-agent \
  awscli \
  gcc-c++ make

# ---- 3. ec2-user として nvm + Node + pnpm + PM2 をセットアップ ----
sudo -u "$APP_USER" -H bash <<EOF
set -euo pipefail

# nvm
if [ ! -d "\$HOME/.nvm" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
export NVM_DIR="\$HOME/.nvm"
. "\$NVM_DIR/nvm.sh"

# Node.js
nvm install ${NODE_VERSION}
nvm alias default ${NODE_VERSION}
nvm use default

# corepack 経由で pnpm 固定
corepack enable
corepack prepare pnpm@${PNPM_VERSION} --activate

# PM2
npm install -g pm2@latest

# 確認
node -v
pnpm -v
pm2 -v
EOF

# ec2-user の bashrc に NVM ロードを保証 (PM2 startup スクリプトと干渉しないため)
if ! grep -q 'NVM_DIR' "/home/${APP_USER}/.bashrc"; then
  cat >> "/home/${APP_USER}/.bashrc" <<'BRC'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
BRC
fi

# ---- 4. 作業ディレクトリ (ログのみ先に作る) ----
# 注意: $APP_DIR は git clone より前に作らない。
#   git clone は "既存の非空ディレクトリ" を拒否するため、
#   先に .env.production を書くと clone が fatal で死ぬ (過去デグレ済 e984d69)。
#   このため $APP_DIR の作成と .env.production の書き込みは clone の "後" にやる。
sudo -u "$APP_USER" mkdir -p "$LOG_DIR"

# ---- 5. SSM Parameter Store から secrets 取得 ----
echo "[user-data] fetching secrets from SSM..."
SSM_BASE="/${APP_NAME}/${ENV_NAME}"

ssm_get() {
  aws ssm get-parameter \
    --name "$1" \
    --with-decryption \
    --region "$AWS_REGION" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || echo ""
}

# RDS の admin 認証情報
DB_CREDS=$(aws secretsmanager get-secret-value \
  --secret-id "$DB_SECRET_ARN" \
  --region "$AWS_REGION" \
  --query 'SecretString' --output text)
DB_USER=$(echo "$DB_CREDS" | jq -r '.username')
DB_PASS=$(echo "$DB_CREDS" | jq -r '.password')

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require"

AUTH_SECRET=$(ssm_get "${SSM_BASE}/auth/secret")
STRIPE_SECRET_KEY=$(ssm_get "${SSM_BASE}/stripe/secret-key")
STRIPE_PUBLISHABLE_KEY=$(ssm_get "${SSM_BASE}/stripe/publishable-key")
STRIPE_WEBHOOK_SECRET=$(ssm_get "${SSM_BASE}/stripe/webhook-secret")
STRIPE_PRICE_STANDARD_MONTHLY=$(ssm_get "${SSM_BASE}/stripe/price/standard-monthly")
STRIPE_PRICE_STANDARD_YEARLY=$(ssm_get "${SSM_BASE}/stripe/price/standard-yearly")
STRIPE_PRICE_PREMIUM_MONTHLY=$(ssm_get "${SSM_BASE}/stripe/price/premium-monthly")
STRIPE_PRICE_PREMIUM_YEARLY=$(ssm_get "${SSM_BASE}/stripe/price/premium-yearly")
CLOUDFRONT_VIDEO_DOMAIN=$(ssm_get "${SSM_BASE}/cloudfront/video-domain")
CLOUDFRONT_ASSET_DOMAIN=$(ssm_get "${SSM_BASE}/cloudfront/asset-domain")
CLOUDFRONT_KEY_PAIR_ID=$(ssm_get "${SSM_BASE}/cloudfront/key-pair-id")
CLOUDFRONT_PRIVATE_KEY=$(ssm_get "${SSM_BASE}/cloudfront/private-key")
IVS_CHANNEL_ARN=$(ssm_get "${SSM_BASE}/ivs/channel-arn")
IVS_PLAYBACK_KEY_PAIR_ID=$(ssm_get "${SSM_BASE}/ivs/playback-key-pair-id")
IVS_PLAYBACK_PRIVATE_KEY=$(ssm_get "${SSM_BASE}/ivs/playback-private-key")
SES_FROM_EMAIL=$(ssm_get "${SSM_BASE}/ses/from-email")
LAWSON_API_BASE=$(ssm_get "${SSM_BASE}/lawson/api-base")
LAWSON_API_KEY=$(ssm_get "${SSM_BASE}/lawson/api-key")
LAWSON_PARTNER_ID=$(ssm_get "${SSM_BASE}/lawson/partner-id")
APP_BASE_URL=$(ssm_get "${SSM_BASE}/app/base-url")

# ---- 5.5. アプリのチェックアウト (env 書き込み前に必須) ----
# git clone は "空でない既存ディレクトリ" に対して fatal で失敗するため、
# 一旦 temp ディレクトリ (同一 FS) に clone してから cp -a で $APP_DIR に展開する。
# こうすることで、後から .env.production を $APP_DIR に書き込んでも
# 次回再起動 (= 同インスタンス内での cloud-init 再実行は無いが、運用上の手動再実行時) でも壊れない。
if [ -n "$APP_REPO_URL" ]; then
  sudo -u "$APP_USER" -H bash <<EOF
set -euo pipefail
export NVM_DIR="/home/${APP_USER}/.nvm"
. "\$NVM_DIR/nvm.sh"

BRANCH="${APP_BRANCH:-main}"
APP_DIR="${APP_DIR}"
TMP_CLONE="/home/${APP_USER}/.app-clone-\$\$"

if [ ! -d "\${APP_DIR}/.git" ]; then
  # 既存ディレクトリ (空でも) を一旦排除して、同一FS上にtemp cloneする
  rm -rf "\$TMP_CLONE"
  git clone --branch "\$BRANCH" "${APP_REPO_URL}" "\$TMP_CLONE"
  mkdir -p "\$APP_DIR"
  shopt -s dotglob
  cp -a "\$TMP_CLONE"/. "\$APP_DIR/"
  shopt -u dotglob
  rm -rf "\$TMP_CLONE"
fi
cd "\$APP_DIR"
git fetch --all
git checkout "\$BRANCH"
git pull --ff-only
EOF
else
  echo "[user-data] APP_REPO_URL is empty - skipping clone."
  sudo -u "$APP_USER" mkdir -p "$APP_DIR"
fi

# ---- 5.6. .env.production を書き込む (clone 完了後) ----
cat > "${APP_DIR}/.env.production" <<ENVEOF
NODE_ENV=production
# DEMO_MODE は本番では明示的に OFF (デモ用のモック Prisma を絶対に有効化しない)
DEMO_MODE=0
NEXT_PUBLIC_DEMO_MODE=0

APP_BASE_URL=${APP_BASE_URL:-http://localhost:3000}
NEXT_PUBLIC_APP_BASE_URL=${APP_BASE_URL:-http://localhost:3000}

AUTH_SECRET=${AUTH_SECRET}
AUTH_URL=${APP_BASE_URL:-http://localhost:3000}
AUTH_TRUST_HOST=true

DATABASE_URL=${DATABASE_URL}

AWS_REGION=${AWS_REGION}
S3_VIDEO_BUCKET=${VIDEO_BUCKET}
S3_ASSET_BUCKET=${ASSET_BUCKET}
S3_MEDIA_OUTPUT_BUCKET=${MEDIA_OUTPUT_BUCKET}

CLOUDFRONT_VIDEO_DOMAIN=${CLOUDFRONT_VIDEO_DOMAIN}
CLOUDFRONT_ASSET_DOMAIN=${CLOUDFRONT_ASSET_DOMAIN}
CLOUDFRONT_KEY_PAIR_ID=${CLOUDFRONT_KEY_PAIR_ID}
CLOUDFRONT_PRIVATE_KEY="${CLOUDFRONT_PRIVATE_KEY}"

IVS_CHANNEL_ARN=${IVS_CHANNEL_ARN}
IVS_PLAYBACK_KEY_PAIR_ID=${IVS_PLAYBACK_KEY_PAIR_ID}
IVS_PLAYBACK_PRIVATE_KEY="${IVS_PLAYBACK_PRIVATE_KEY}"

SES_FROM_EMAIL=${SES_FROM_EMAIL:-no-reply@example.com}

STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
STRIPE_PUBLISHABLE_KEY=${STRIPE_PUBLISHABLE_KEY}
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${STRIPE_PUBLISHABLE_KEY}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
STRIPE_PRICE_STANDARD_MONTHLY=${STRIPE_PRICE_STANDARD_MONTHLY}
STRIPE_PRICE_STANDARD_YEARLY=${STRIPE_PRICE_STANDARD_YEARLY}
STRIPE_PRICE_PREMIUM_MONTHLY=${STRIPE_PRICE_PREMIUM_MONTHLY}
STRIPE_PRICE_PREMIUM_YEARLY=${STRIPE_PRICE_PREMIUM_YEARLY}

LAWSON_TICKET_API_BASE=${LAWSON_API_BASE}
LAWSON_TICKET_API_KEY=${LAWSON_API_KEY}
LAWSON_TICKET_PARTNER_ID=${LAWSON_PARTNER_ID}
ENVEOF

chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env.production"
chmod 600 "${APP_DIR}/.env.production"

# ---- 6. 依存解決 & ビルド ----
if [ -d "${APP_DIR}/.git" ]; then
  sudo -u "$APP_USER" -H bash <<EOF
set -euo pipefail
export NVM_DIR="/home/${APP_USER}/.nvm"
. "\$NVM_DIR/nvm.sh"
cd "${APP_DIR}"

# pnpm がモノレポルートで全 workspace 依存を解決
pnpm install --frozen-lockfile

# Prisma generate (build 前に必須)
pnpm --filter @idol/db prisma:generate || true

# Prisma migrate (失敗しても起動は続行)
pnpm --filter @idol/db prisma:migrate:deploy || echo "[user-data] prisma migrate failed, continuing"

# Next.js standalone build
pnpm --filter @idol/web build

# Next.js 16 standalone は .next/static と public を自動コピーしないため手動でコピー
# (これが無いと CSS/JS chunk が 404 になる)
STANDALONE_DIR="${APP_DIR}/apps/web/.next/standalone/apps/web"
if [ -d "\$STANDALONE_DIR" ]; then
  echo "[user-data] copying .next/static and public into standalone..."
  rm -rf "\$STANDALONE_DIR/.next/static"
  cp -a "${APP_DIR}/apps/web/.next/static" "\$STANDALONE_DIR/.next/static"
  if [ -d "${APP_DIR}/apps/web/public" ]; then
    rm -rf "\$STANDALONE_DIR/public"
    cp -a "${APP_DIR}/apps/web/public" "\$STANDALONE_DIR/public"
  fi
else
  echo "[user-data] WARN: standalone dir not found at \$STANDALONE_DIR"
fi
EOF
else
  echo "[user-data] APP_DIR has no .git - skipping build. Run manual deploy via SSM."
fi

# ---- 7. nginx をリバースプロキシとして起動 (3000 -> 80/443) ----
cat > /etc/nginx/conf.d/app.conf <<'NGINXEOF'
upstream nextjs_upstream {
  server 127.0.0.1:3000;
  keepalive 32;
}
server {
  listen 80 default_server;
  server_name _;

  client_max_body_size 50M;
  proxy_read_timeout 300s;
  proxy_connect_timeout 75s;

  location /_next/static/ {
    proxy_pass http://nextjs_upstream;
    proxy_cache_valid 200 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location / {
    proxy_pass http://nextjs_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
  }
}
NGINXEOF

systemctl enable nginx
systemctl restart nginx

# ---- 8. PM2 でアプリ起動 + systemd 登録 ----
if [ -f "${APP_DIR}/deploy/ecosystem.config.js" ]; then
  sudo -u "$APP_USER" -H bash <<EOF
set -euo pipefail
export NVM_DIR="/home/${APP_USER}/.nvm"
. "\$NVM_DIR/nvm.sh"
cd "${APP_DIR}"
# HOSTNAME=0.0.0.0 を明示的に export してから PM2 起動
# (Next.js standalone server.js は env HOSTNAME が無いと os.hostname() に fallback し、
#  eth0 の private IP にバインドして nginx の upstream connect が refused になる)
export HOSTNAME=0.0.0.0
export PORT=3000
export NODE_ENV=production
pm2 start deploy/ecosystem.config.js --env production --update-env
pm2 save
EOF

  # systemd 登録 (root 権限で)
  PM2_PATH=$(sudo -u "$APP_USER" -H bash -c 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; which pm2')
  env PATH="$PATH:$(dirname "$PM2_PATH")" "$PM2_PATH" startup systemd \
    -u "$APP_USER" --hp "/home/${APP_USER}" || true
  systemctl enable "pm2-${APP_USER}" || true
fi

# ---- 9. CloudWatch Agent (基本メトリクス + ログ収集) ----
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<CWEOF
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "cwagent"
  },
  "metrics": {
    "namespace": "${APP_NAME}/${ENV_NAME}",
    "append_dimensions": {
      "InstanceId": "\${aws:InstanceId}"
    },
    "metrics_collected": {
      "cpu": { "measurement": ["usage_idle", "usage_user", "usage_system"], "metrics_collection_interval": 60 },
      "mem": { "measurement": ["mem_used_percent"], "metrics_collection_interval": 60 },
      "disk": { "measurement": ["used_percent"], "metrics_collection_interval": 60, "resources": ["/"] }
    }
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          { "file_path": "${LOG_DIR}/web-out.log", "log_group_name": "/${APP_NAME}/${ENV_NAME}/web/stdout", "log_stream_name": "{instance_id}" },
          { "file_path": "${LOG_DIR}/web-err.log", "log_group_name": "/${APP_NAME}/${ENV_NAME}/web/stderr", "log_stream_name": "{instance_id}" },
          { "file_path": "/var/log/nginx/access.log", "log_group_name": "/${APP_NAME}/${ENV_NAME}/nginx/access", "log_stream_name": "{instance_id}" },
          { "file_path": "/var/log/nginx/error.log", "log_group_name": "/${APP_NAME}/${ENV_NAME}/nginx/error", "log_stream_name": "{instance_id}" }
        ]
      }
    }
  }
}
CWEOF

systemctl enable amazon-cloudwatch-agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s

echo "[user-data] done $(date -u +%FT%TZ)"
