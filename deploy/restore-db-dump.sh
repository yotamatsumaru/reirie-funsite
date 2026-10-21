#!/bin/bash
# =====================================================================
# pg_dump (custom 形式) からの復元 / 復元テスト
#
#   既定では **本番 DB を一切触らず**、同じ RDS 上に新しいデータベース
#   (例: idol_fansite_restore_20261021) を作ってそこへ復元する。
#   中身を確認してから、アプリの DATABASE_URL を切り替える or 必要な行だけ
#   コピーする、という手順を想定している (docs/SECURITY_BACKUP.md 参照)。
#
#   ⚠️ EC2 ロールにはバックアップバケットの読み取り権限が無い (乗っ取られても
#      バックアップを持ち出せないようにするため)。ダンプは運用者が自分の
#      認証情報で取得してから渡すこと:
#        aws s3 cp s3://<bucket>/pg_dump/2026/10/21/xxx.dump /tmp/restore.dump
#
#   使い方:
#     bash deploy/restore-db-dump.sh /tmp/restore.dump
#         → 新規 DB idol_fansite_restore_<日付> に復元して行数サマリを表示
#     TARGET_DB=idol_fansite_restore_test bash deploy/restore-db-dump.sh /tmp/restore.dump
#     LIST_ONLY=1 bash deploy/restore-db-dump.sh /tmp/restore.dump   # 目次だけ表示
#
#   本番 DB (DATABASE_URL の DB) への上書き復元は、このスクリプトでは行わない。
#   (誤操作 1 回で最新データを失うため。必要な場合は RUNBOOK の手順で
#    復元 DB を確認したうえで DATABASE_URL を切り替える)
# =====================================================================
set -euo pipefail

DUMP="${1:-}"
APP_DIR="${APP_DIR:-/home/ec2-user/app}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.production}"
LIST_ONLY="${LIST_ONLY:-0}"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "usage: $0 <dump-file>" >&2
  exit 1
fi

pg_restore --list "$DUMP" >/dev/null || { echo "dump is unreadable / corrupted" >&2; exit 1; }
if [ "$LIST_ONLY" = "1" ]; then
  pg_restore --list "$DUMP"
  exit 0
fi

env_get() {
  grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

DATABASE_URL="${DATABASE_URL:-$(env_get DATABASE_URL)}"
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL not found" >&2; exit 1; }

# postgresql://user:pass@host:port/dbname?params
BASE="${DATABASE_URL%%\?*}"
PROD_DB="${BASE##*/}"
SERVER_URL="${BASE%/*}"
TARGET_DB="${TARGET_DB:-${PROD_DB}_restore_$(date '+%Y%m%d%H%M')}"

if ! [[ "$TARGET_DB" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
  echo "invalid TARGET_DB name: $TARGET_DB" >&2
  exit 1
fi
if [ "$TARGET_DB" = "$PROD_DB" ]; then
  echo "refusing to restore over the production database ($PROD_DB)" >&2
  exit 1
fi

ADMIN_URL="${SERVER_URL}/postgres?sslmode=require"
TARGET_URL="${SERVER_URL}/${TARGET_DB}?sslmode=require"

echo "[restore] create database ${TARGET_DB}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"${TARGET_DB}\";"

echo "[restore] pg_restore → ${TARGET_DB}"
pg_restore \
  --dbname="$TARGET_URL" \
  --no-owner \
  --no-acl \
  --exit-on-error \
  --jobs=2 \
  "$DUMP"

echo "[restore] row counts (top 20 tables):"
psql "$TARGET_URL" -q -P pager=off -c "
  SELECT relname AS table, n_live_tup AS rows
  FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;" || true
psql "$TARGET_URL" -q -P pager=off -c "ANALYZE;" >/dev/null 2>&1 || true

# 認証情報をログ / 端末に出さない
MASKED_SERVER="$(printf '%s' "$SERVER_URL" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#')"
cat <<EOF

[restore] 完了: ${TARGET_DB}
  接続先: ${MASKED_SERVER}/${TARGET_DB}
  不要になったら削除:
          psql "${MASKED_SERVER}/postgres" -c 'DROP DATABASE "${TARGET_DB}";'
EOF
