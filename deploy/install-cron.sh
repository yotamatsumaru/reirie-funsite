#!/bin/bash
# =====================================================================
# 定期実行 (cron) の登録 — 冪等
#
#   root で実行すること。/etc/cron.d/ にファイルを置く方式を採用している。
#
#   なぜ crontab -e ではなく /etc/cron.d なのか:
#     - デプロイのたびに実行されても内容が上書きされるだけで重複しない (冪等)。
#     - ファイルとして git 管理された内容がそのまま反映され、
#       「サーバー上で誰かが手で直した」状態と乖離しにくい。
#
#   登録するジョブ:
#     1. 誕生日メール自動送信トリガー (5 分おき)
#        送信時刻の判断はアプリ側 (DB 設定) が行うため、時刻を管理画面で
#        変更しても この cron を変える必要はない。
#
#   使い方:
#     sudo bash deploy/install-cron.sh
# =====================================================================
set -euo pipefail

APP_USER="${APP_USER:-ec2-user}"
APP_DIR="${APP_DIR:-/home/${APP_USER}/app}"
CRON_FILE="/etc/cron.d/idol-fansite"

# cronie (crond) が無い環境ではインストールする。
if ! command -v crond >/dev/null 2>&1 && ! systemctl list-unit-files 2>/dev/null | grep -q '^crond'; then
  echo "[install-cron] installing cronie..."
  dnf -y install cronie >/dev/null 2>&1 || yum -y install cronie >/dev/null 2>&1 || true
fi

echo "[install-cron] writing $CRON_FILE ..."
cat > "$CRON_FILE" <<CRONEOF
# idol-fansite 定期ジョブ (deploy/install-cron.sh が生成 — 手で編集しないこと)
# /etc/cron.d 形式なので実行ユーザー欄が必要。
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# 誕生日メール 自動送信トリガー (5 分おき)
#   送信時刻は管理画面 (/super-admin/birthday) の設定で決まる。既定 12:00 JST。
#   エンドポイントは冪等で、時刻前 / 本日実行済みなら何もしない。
*/5 * * * * ${APP_USER} APP_DIR=${APP_DIR} bash ${APP_DIR}/deploy/cron-birthday-mail.sh >/dev/null 2>&1
CRONEOF

chown root:root "$CRON_FILE"
# /etc/cron.d のファイルは 0644 でなければ crond に無視される (0600 等は不可)。
chmod 0644 "$CRON_FILE"

# 実行スクリプトに実行権限を付けておく (git の mode が落ちている場合の保険)。
if [ -f "${APP_DIR}/deploy/cron-birthday-mail.sh" ]; then
  chmod 0755 "${APP_DIR}/deploy/cron-birthday-mail.sh" || true
fi

echo "[install-cron] enabling crond ..."
systemctl enable crond >/dev/null 2>&1 || true
systemctl restart crond >/dev/null 2>&1 || systemctl start crond >/dev/null 2>&1 || true

echo "[install-cron] done. registered jobs:"
cat "$CRON_FILE"
