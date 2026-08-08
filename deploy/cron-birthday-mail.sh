#!/bin/bash
# =====================================================================
# 誕生日メール 自動送信トリガー (cron から 5 分おきに実行)
#
#   /api/cron/birthday-mail を localhost 経由で叩くだけの薄いスクリプト。
#   「いつ送るか」はアプリ側 (DB の AppSetting: birthdayMail.schedule) が
#   判断するため、送信時刻を管理画面で変更しても このスクリプトや crontab の
#   変更・再デプロイは一切不要。
#
#   なぜ 5 分おきなのか:
#     crontab に送信時刻を書くと「管理画面から時刻を変更できる」という要件を
#     満たせない (変更のたびに EC2 の crontab を書き換える運用になってしまう)。
#     そこで cron は「定期的に確認する」役だけを担い、時刻の判断は DB 設定を
#     読むアプリ側に寄せている。エンドポイントは冪等で、送信時刻前や
#     本日実行済みの場合は何もせず 200 を返す。
#
#   ログ: /home/ec2-user/logs/cron-birthday-mail.log
#     (CloudWatch Agent が収集する logs ディレクトリに置く)
# =====================================================================
set -uo pipefail

APP_DIR="${APP_DIR:-/home/ec2-user/app}"
ENV_FILE="$APP_DIR/.env.production"
LOG_DIR="${LOG_DIR:-/home/ec2-user/logs}"
LOG_FILE="$LOG_DIR/cron-birthday-mail.log"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:3000/api/cron/birthday-mail}"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S %z')] $*" >> "$LOG_FILE"
}

if [ ! -f "$ENV_FILE" ]; then
  log "ERROR: env file not found: $ENV_FILE"
  exit 1
fi

# CRON_SECRET を .env.production から取り出す。
#   値にシェルのメタ文字が含まれても壊れないよう `source` は使わず、
#   該当行だけを取り出して前後のクォートを剥がす (openssl rand -hex なので
#   実際には英数字のみだが、運用で手書き変更された場合にも耐えるようにする)。
CRON_SECRET=$(grep -m1 '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")

if [ -z "${CRON_SECRET:-}" ]; then
  log "ERROR: CRON_SECRET is empty in $ENV_FILE - skipping"
  exit 1
fi

# --max-time: アプリが固まっていても cron プロセスを溜めない。
# 一斉送信 (SES へ 1 通ずつ) に時間がかかる可能性があるため 120 秒まで待つ。
RESPONSE=$(curl -sS \
  --max-time 120 \
  --connect-timeout 5 \
  -w '\n%{http_code}' \
  -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -d '{}' 2>&1)
CURL_EXIT=$?

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$CURL_EXIT" -ne 0 ]; then
  log "ERROR: curl failed (exit $CURL_EXIT): $RESPONSE"
  exit 1
fi

if [ "$HTTP_CODE" != "200" ]; then
  log "ERROR: HTTP $HTTP_CODE - $BODY"
  exit 1
fi

# status を取り出して 1 行に要約する。
#   not-due / already-ran は 1 日に何十回も出るため、ログには残さず捨てる
#   (ログが単調に膨らみ、本当のエラーが埋もれるのを避ける)。
STATUS=$(echo "$BODY" | jq -r '.status // "unknown"' 2>/dev/null || echo 'unknown')
case "$STATUS" in
  not-due|already-ran)
    exit 0
    ;;
  *)
    log "status=$STATUS $BODY"
    ;;
esac

exit 0
