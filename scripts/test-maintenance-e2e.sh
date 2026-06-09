#!/bin/bash
# Maintenance Mode E2E Test
#
# 1. SUPER_ADMIN でログイン (Auth.js Credentials)
# 2. PATCH /api/super-admin/settings { key: 'maintenance.enabled', value: true }
# 3. ゲスト (cookie 無し) で GET / → 307 redirect to /maintenance を期待
# 4. SUPER_ADMIN cookie で GET /super-admin → 200 を期待 (bypass)
# 5. cleanup: maintenance.enabled = false に戻す

set -eo pipefail
BASE=${BASE:-http://localhost:3000}
COOKIES=$(mktemp)
trap "rm -f $COOKIES" EXIT

echo "=== 1) Login as SUPER_ADMIN ==="
# CSRF token 取得
CSRF_JSON=$(curl -s -c "$COOKIES" "$BASE/api/auth/csrf")
CSRF_TOKEN=$(echo "$CSRF_JSON" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
echo "  csrfToken: ${CSRF_TOKEN:0:32}..."

# Credentials provider にログイン
LOGIN_RESP=$(curl -s -i -b "$COOKIES" -c "$COOKIES" -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "email=super@example.com" \
  --data-urlencode "password=demo" \
  --data-urlencode "csrfToken=$CSRF_TOKEN" \
  --data-urlencode "callbackUrl=$BASE/" \
  --data-urlencode "redirect=false" \
  "$BASE/api/auth/callback/credentials")
echo "  Login response status: $(echo "$LOGIN_RESP" | head -1)"

# Session 確認
SESSION=$(curl -s -b "$COOKIES" "$BASE/api/auth/session")
echo "  Session: $SESSION"

echo ""
echo "=== 2) Enable maintenance mode ==="
ENABLE_RESP=$(curl -s -b "$COOKIES" -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"key":"maintenance.enabled","value":true}' \
  "$BASE/api/super-admin/settings")
echo "  Response: $ENABLE_RESP"

echo ""
echo "=== 3) Guest access (no cookie) ==="
for path in / /contents /products /game /notices; do
  # 注: --max-redirs 0 だと 3xx を許可せず失敗するので使わない
  RESULT=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" "$BASE$path" || true)
  echo "  $path -> $RESULT"
done

echo ""
echo "=== 4) SUPER_ADMIN bypass access (with cookie) ==="
for path in /super-admin /super-admin/settings /maintenance; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES" --max-redirs 0 "$BASE$path")
  echo "  $CODE $path"
done

echo ""
echo "=== 5) Cleanup: disable maintenance ==="
DISABLE_RESP=$(curl -s -b "$COOKIES" -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"key":"maintenance.enabled","value":false}' \
  "$BASE/api/super-admin/settings")
echo "  Response: $DISABLE_RESP"

echo ""
echo "=== 6) Verify guest can access again ==="
RESULT=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" "$BASE/" || true)
echo "  / -> $RESULT"
