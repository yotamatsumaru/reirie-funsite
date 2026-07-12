#!/bin/bash
# =====================================================================
# Cloudflare Origin CA 証明書を SSM Parameter Store から取得し、
# nginx に反映して再起動するスクリプト。
#
# 用途:
#   - 初回セットアップ後に証明書を発行/更新した場合、
#     EC2 インスタンスの再作成 (CDK userDataCausesReplacement) を
#     待たずに、SSM Session Manager 経由でこのスクリプトを叩くだけで
#     Full/Strict (443) を有効化・更新できる。
#
# 前提:
#   - SSM Parameter Store に以下の SecureString が登録済みであること
#       /<APP_NAME>/<ENV_NAME>/tls/cert-pem  (Origin Certificate, PEM)
#       /<APP_NAME>/<ENV_NAME>/tls/key-pem   (Private Key, PEM)
#   - EC2 の IAM Role が ssm:GetParameter を許可されていること
#     (既存の ec2-stack.ts で /<APP_NAME>/<ENV_NAME>/* に対して許可済み)
#
# 実行方法 (SSM Session Manager で EC2 に接続後、root で実行):
#   sudo APP_NAME=idol-fansite ENV_NAME=dev AWS_REGION=ap-northeast-1 \
#     bash /home/ec2-user/app/deploy/setup-tls.sh
# =====================================================================
set -euo pipefail

APP_NAME="${APP_NAME:-idol-fansite}"
ENV_NAME="${ENV_NAME:-dev}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"
SSM_BASE="/${APP_NAME}/${ENV_NAME}"

if [ "$(id -u)" -ne 0 ]; then
  echo "[setup-tls] このスクリプトは root (sudo) で実行してください" >&2
  exit 1
fi

echo "[setup-tls] fetching cert from SSM (${SSM_BASE}/tls/cert-pem) ..."
TLS_CERT_PEM=$(aws ssm get-parameter \
  --name "${SSM_BASE}/tls/cert-pem" \
  --with-decryption \
  --region "$AWS_REGION" \
  --query 'Parameter.Value' \
  --output text 2>/dev/null || echo "")
TLS_KEY_PEM=$(aws ssm get-parameter \
  --name "${SSM_BASE}/tls/key-pem" \
  --with-decryption \
  --region "$AWS_REGION" \
  --query 'Parameter.Value' \
  --output text 2>/dev/null || echo "")

if [ -z "$TLS_CERT_PEM" ] || [ -z "$TLS_KEY_PEM" ]; then
  echo "[setup-tls][ERROR] SSM に証明書が見つかりません。先に登録してください:" >&2
  echo "  aws ssm put-parameter --name ${SSM_BASE}/tls/cert-pem --type SecureString --value \"\$(cat origin.pem)\" --overwrite" >&2
  echo "  aws ssm put-parameter --name ${SSM_BASE}/tls/key-pem  --type SecureString --value \"\$(cat origin.key)\" --overwrite" >&2
  exit 1
fi

mkdir -p /etc/nginx/ssl
printf '%s\n' "$TLS_CERT_PEM" > /etc/nginx/ssl/cloudflare-origin.pem
printf '%s\n' "$TLS_KEY_PEM" > /etc/nginx/ssl/cloudflare-origin.key
chmod 600 /etc/nginx/ssl/cloudflare-origin.key
echo "[setup-tls] certificate written to /etc/nginx/ssl/"

cat > /etc/nginx/conf.d/app.conf <<'NGINXEOF'
upstream nextjs_upstream {
  server 127.0.0.1:3000;
  keepalive 32;
}

# CloudFront 経由の場合、CloudFront Function (viewer-request) が元の
# ビューワードメイン (reirie.com / www.reirie.com) を X-Forwarded-Host に
# コピーしてから、オリジンへの Host ヘッダーをオリジンのホスト名
# (origin-app.<domain>) に書き換えて転送してくる。
# X-Forwarded-Host が無い場合 (CloudFront を経由しない直アクセス等) は
# $host にフォールバックする。
map $http_x_forwarded_host $proxied_host {
  default $http_x_forwarded_host;
  ''      $host;
}

server {
  listen 80 default_server;
  server_name _;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl default_server;
  http2 on;
  server_name _;

  ssl_certificate     /etc/nginx/ssl/cloudflare-origin.pem;
  ssl_certificate_key /etc/nginx/ssl/cloudflare-origin.key;
  ssl_protocols TLSv1.2 TLSv1.3;

  client_max_body_size 50M;
  proxy_read_timeout 300s;
  proxy_connect_timeout 75s;

  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

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
    proxy_set_header X-Forwarded-Host $proxied_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
  }
}
NGINXEOF

nginx -t
systemctl reload nginx
echo "[setup-tls] done. nginx is now serving HTTPS (443) with Cloudflare Origin CA cert."
