#!/bin/bash
# =====================================================================
# PostgreSQL 論理バックアップ (pg_dump) → Object Lock 付き S3 へ保存
#
#   deploy/install-cron.sh から毎日 1 回 (JST 03:30) 実行される。
#
#   なぜ RDS の自動バックアップに加えて pg_dump も取るのか:
#     - RDS スナップショット / AWS Backup は「AWS アカウント内」でしか復元できない。
#       pg_dump はどこの PostgreSQL にでも復元できるため、アカウント乗っ取り・
#       リージョン障害・誤った DB 削除など最悪のケースの最後の砦になる。
#     - 「特定テーブルだけ」「特定ユーザーの行だけ」を戻したいときにも使える。
#
#   安全設計:
#     - 保存先バケットは S3 Object Lock (WORM)。保持期間中は誰も削除・上書きできない。
#     - EC2 ロールには s3:PutObject しか無い (このサーバーが乗っ取られても
#       既存のバックアップを読む・消すことはできない)。
#     - アップロード前に pg_restore --list でダンプの整合性を検証する。
#     - 成功時に CloudWatch メトリクス DbDumpSuccess=1 を送る。26 時間届かないと
#       BackupStack のアラームが SNS で通知する (= 黙って止まらない)。
#
#   使い方:
#     bash deploy/backup-db.sh                    # 通常実行 (cron と同じ)
#     DRY_RUN=1 bash deploy/backup-db.sh          # ダンプ + 検証のみ (S3 へ送らない)
#
#   ログ: /home/ec2-user/logs/backup-db.log
# =====================================================================
set -uo pipefail

APP_DIR="${APP_DIR:-/home/ec2-user/app}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.production}"
LOG_DIR="${LOG_DIR:-/home/ec2-user/logs}"
LOG_FILE="$LOG_DIR/backup-db.log"
WORK_DIR="${WORK_DIR:-/home/ec2-user/backup-tmp}"
APP_NAME="${APP_NAME:-idol-fansite}"
ENV_NAME="${ENV_NAME:-dev}"
DRY_RUN="${DRY_RUN:-0}"
LOCK_FILE="/tmp/idol-fansite-backup-db.lock"

mkdir -p "$LOG_DIR" "$WORK_DIR"
chmod 700 "$WORK_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S %z')] $*" | tee -a "$LOG_FILE"
}

fail() {
  log "ERROR: $*"
  put_metric DbDumpFailure 1 || true
  exit 1
}

# .env.production から KEY=VALUE を 1 行取り出す (source は使わない — 値にメタ文字が入り得るため)
env_get() {
  grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

put_metric() {
  [ "$DRY_RUN" = "1" ] && return 0
  aws cloudwatch put-metric-data \
    --region "$AWS_REGION" \
    --namespace "${APP_NAME}/Backup" \
    --metric-name "$1" \
    --dimensions "Env=${ENV_NAME}" \
    --unit Count \
    --value "$2" >/dev/null 2>&1
}

# 同時実行防止 (前回が長引いている場合は今回をスキップ)
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "WARN: another backup is running; skip"
  exit 0
fi

[ -f "$ENV_FILE" ] || { echo "env file not found: $ENV_FILE" >&2; exit 1; }

AWS_REGION="${AWS_REGION:-$(env_get AWS_REGION)}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"
export AWS_REGION

DATABASE_URL="$(env_get DATABASE_URL)"
[ -n "$DATABASE_URL" ] || fail "DATABASE_URL is empty in $ENV_FILE"

# Prisma 専用のクエリパラメータ (schema=...) は libpq が受け付けないので除去する。
# sslmode=require 等の libpq パラメータは残す。
PG_URL="$(printf '%s' "$DATABASE_URL" \
  | sed -E 's/([?&])schema=[^&]*(&|$)/\1/; s/[?&]$//; s/\?&/?/')"
case "$PG_URL" in
  *sslmode=*) ;;
  *\?*) PG_URL="${PG_URL}&sslmode=require" ;;
  *) PG_URL="${PG_URL}?sslmode=require" ;;
esac

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found (dnf -y install postgresql15)"
command -v pg_restore >/dev/null 2>&1 || fail "pg_restore not found"

BUCKET="${BACKUP_BUCKET:-}"
if [ -z "$BUCKET" ] && [ "$DRY_RUN" != "1" ]; then
  BUCKET="$(aws ssm get-parameter \
    --region "$AWS_REGION" \
    --name "/${APP_NAME}/${ENV_NAME}/backup/dump-bucket" \
    --query 'Parameter.Value' --output text 2>/dev/null || true)"
  [ -n "$BUCKET" ] && [ "$BUCKET" != "None" ] \
    || fail "backup bucket not found in SSM /${APP_NAME}/${ENV_NAME}/backup/dump-bucket (deploy the *-backup stack first)"
fi

TS="$(date -u '+%Y%m%dT%H%M%SZ')"
DATE_PATH="$(date -u '+%Y/%m/%d')"
DUMP_FILE="$WORK_DIR/${APP_NAME}-${ENV_NAME}-${TS}.dump"
trap 'rm -f "$DUMP_FILE" "$DUMP_FILE.sha256"' EXIT

log "start pg_dump (env=$ENV_NAME, dry_run=$DRY_RUN)"
START=$(date +%s)

# --format=custom: 圧縮済み・テーブル単位で選択復元できる形式
# --no-owner / --no-acl: 別環境 (別ユーザー名) にも復元できるようにする
if ! pg_dump \
    --dbname="$PG_URL" \
    --format=custom \
    --compress=6 \
    --no-owner \
    --no-acl \
    --file="$DUMP_FILE" 2>>"$LOG_FILE"; then
  fail "pg_dump failed"
fi

# 整合性検証: 目次を読めなければ壊れている
if ! pg_restore --list "$DUMP_FILE" >/dev/null 2>>"$LOG_FILE"; then
  fail "pg_restore --list failed (dump is corrupted)"
fi
TABLE_COUNT=$(pg_restore --list "$DUMP_FILE" 2>/dev/null | grep -c ' TABLE DATA ' || true)
SIZE=$(stat -c %s "$DUMP_FILE")
SHA256=$(sha256sum "$DUMP_FILE" | awk '{print $1}')
[ "$SIZE" -gt 1024 ] || fail "dump is suspiciously small (${SIZE} bytes)"
[ "${TABLE_COUNT:-0}" -gt 0 ] || fail "dump contains no table data"

log "dump ok: size=${SIZE} bytes, tables=${TABLE_COUNT}, sha256=${SHA256}"

if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1: skip upload"
  exit 0
fi

KEY="pg_dump/${DATE_PATH}/$(basename "$DUMP_FILE")"
# Object Lock バケットへの PutObject にはチェックサムが必須なので明示する
if ! aws s3 cp "$DUMP_FILE" "s3://${BUCKET}/${KEY}" \
    --region "$AWS_REGION" \
    --only-show-errors \
    --checksum-algorithm SHA256 \
    --metadata "sha256=${SHA256},tables=${TABLE_COUNT}" 2>>"$LOG_FILE"; then
  fail "upload to s3://${BUCKET}/${KEY} failed"
fi

ELAPSED=$(( $(date +%s) - START ))
log "uploaded s3://${BUCKET}/${KEY} (${ELAPSED}s)"

put_metric DbDumpSuccess 1 || log "WARN: failed to put DbDumpSuccess metric"
aws cloudwatch put-metric-data \
  --region "$AWS_REGION" \
  --namespace "${APP_NAME}/Backup" \
  --metric-name DbDumpSizeBytes \
  --dimensions "Env=${ENV_NAME}" \
  --unit Bytes \
  --value "$SIZE" >/dev/null 2>&1 || true

log "done"
