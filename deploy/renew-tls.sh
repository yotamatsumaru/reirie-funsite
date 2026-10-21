#!/bin/bash
# =====================================================================
# オリジン (EC2) の Let's Encrypt 証明書を更新して nginx をリロードする。
#
# 【背景 / 2026-10-10 の障害】
#   origin-app.reirie.com の証明書 (Let's Encrypt, 90日) が失効し、
#   CloudFront (HTTPS_ONLY でオリジン接続) が TLS 検証に失敗して
#   reirie.com 全体が 502 Bad Gateway になった。
#   EC2 直アクセス (origin-app.reirie.com) は 200 で、アプリ自体は正常だった。
#
#   certbot の自動更新 (systemd timer / cron) が動いていなかったのが原因なので、
#   このスクリプトを deploy/install-cron.sh から毎日 cron で実行し、
#   期限 30 日前になれば自動更新されるようにする。
#
# 使い方 (root):
#   sudo bash /home/ec2-user/app/deploy/renew-tls.sh            # 期限が近ければ更新
#   sudo FORCE=1 bash /home/ec2-user/app/deploy/renew-tls.sh    # 強制更新 (失効後の復旧用)
# =====================================================================
set -uo pipefail

FORCE="${FORCE:-0}"
LOG_TAG="[renew-tls]"

if [ "$(id -u)" -ne 0 ]; then
  echo "$LOG_TAG root (sudo) で実行してください" >&2
  exit 1
fi

# certbot が無ければインストールを試みる (Amazon Linux 2023: dnf / pip)
if ! command -v certbot >/dev/null 2>&1; then
  echo "$LOG_TAG certbot が見つからないためインストールします..."
  dnf -y install certbot python3-certbot-nginx >/dev/null 2>&1 \
    || pip3 install certbot certbot-nginx >/dev/null 2>&1 \
    || { echo "$LOG_TAG certbot のインストールに失敗しました" >&2; exit 1; }
fi

ARGS=(renew --non-interactive --quiet)
if [ "$FORCE" = "1" ]; then
  ARGS+=(--force-renewal)
fi
# 更新に成功したときだけ nginx をリロード (証明書を読み直す)
ARGS+=(--deploy-hook "systemctl reload nginx")

echo "$LOG_TAG certbot ${ARGS[*]}"
if certbot "${ARGS[@]}"; then
  echo "$LOG_TAG OK"
else
  echo "$LOG_TAG certbot renew が失敗しました。手動確認: sudo certbot certificates" >&2
  exit 1
fi

# 現在の証明書の期限を表示 (ログで一目で分かるように)
if [ -f /etc/letsencrypt/live/origin-app.reirie.com/fullchain.pem ]; then
  echo -n "$LOG_TAG 現在の期限: "
  openssl x509 -noout -enddate -in /etc/letsencrypt/live/origin-app.reirie.com/fullchain.pem
fi
