#!/bin/bash
# =====================================================================
# セキュリティ / バックアップ運用ヘルパー (運用者の PC で実行する)
#
#   必要: AWS CLI v2 + 管理者の認証情報 (aws configure 済み), jq
#   詳細は docs/SECURITY_BACKUP.md
#
#   使い方:
#     bash deploy/security-ops.sh waf-report [日数]   WAF の検知状況 (ルール別の件数) を表示
#     bash deploy/security-ops.sh waf-samples <ルール名>  直近 3 時間の検知リクエスト例を表示
#     bash deploy/security-ops.sh backup-status        バックアップ / コピー / 復元ジョブの直近結果
#     bash deploy/security-ops.sh restore-test-now     最新の復旧ポイントから今すぐ復元テスト
#     bash deploy/security-ops.sh vault-lock-status    Vault Lock の状態 (governance/compliance) を表示
# =====================================================================
set -euo pipefail

APP="${APP_NAME:-idol-fansite}"
ENV="${ENV_NAME:-dev}"
REGION="${AWS_REGION:-ap-northeast-1}"
COPY_REGION="${BACKUP_COPY_REGION:-ap-northeast-3}"
WAF_NAME="${APP}-${ENV}-site-waf"
METRIC_PREFIX="$(echo "${APP}-${ENV}-waf" | tr '-' '_')"
VAULT="${APP}-${ENV}-vault-primary"
COPY_VAULT="${APP}-${ENV}-vault-copy"
DB_ID="${APP}-${ENV}-rds"

need() { command -v "$1" >/dev/null 2>&1 || { echo "$1 が必要です" >&2; exit 1; }; }
need aws
need jq

# date の差分 (GNU / BSD(macOS) 両対応)
ago() {
  local secs=$1
  if date -u -d "@0" >/dev/null 2>&1; then
    date -u -d "@$(( $(date +%s) - secs ))" '+%Y-%m-%dT%H:%M:%SZ'
  else
    date -u -r "$(( $(date +%s) - secs ))" '+%Y-%m-%dT%H:%M:%SZ'
  fi
}

waf_report() {
  local days="${1:-7}"
  local start end
  start="$(ago $(( days * 86400 )))"
  end="$(ago 0)"
  echo "== WAF 検知件数 (直近 ${days} 日, ${WAF_NAME}) =="
  echo "   Count = 検知のみ (通過させた) / Block = 遮断した"
  printf '%-45s %10s %10s\n' "ルール" "Count" "Block"
  for rule in AWSManagedRulesAmazonIpReputationList RateLimitAuth RateLimitGlobal \
              AWSManagedRulesCommonRuleSet AWSManagedRulesKnownBadInputsRuleSet AWSManagedRulesSQLiRuleSet; do
    local counted blocked
    for kind in CountedRequests BlockedRequests; do
      local v
      v="$(aws cloudwatch get-metric-statistics --region us-east-1 \
        --namespace AWS/WAFV2 --metric-name "$kind" \
        --dimensions Name=WebACL,Value="$WAF_NAME" Name=Rule,Value="${METRIC_PREFIX}_${rule}" \
        --start-time "$start" --end-time "$end" --period $(( days * 86400 )) --statistics Sum \
        --query 'Datapoints[0].Sum' --output text 2>/dev/null || echo 0)"
      [ "$v" = "None" ] && v=0
      if [ "$kind" = CountedRequests ]; then counted="${v%.*}"; else blocked="${v%.*}"; fi
    done
    printf '%-45s %10s %10s\n' "$rule" "$counted" "$blocked"
  done
  echo
  echo "Count が多いルールは 'waf-samples <ルール名>' で中身を確認してください。"
  echo "正規の操作 (管理画面の投稿・画像アップロード・決済など) が含まれていなければ block に切替可能です。"
}

waf_samples() {
  local rule="${1:?ルール名を指定してください (例: AWSManagedRulesCommonRuleSet)}"
  local acl_arn
  acl_arn="$(aws wafv2 list-web-acls --region us-east-1 --scope CLOUDFRONT \
    --query "WebACLs[?Name=='${WAF_NAME}'].ARN | [0]" --output text)"
  [ -n "$acl_arn" ] && [ "$acl_arn" != "None" ] || { echo "Web ACL ${WAF_NAME} が見つかりません" >&2; exit 1; }
  aws wafv2 get-sampled-requests --region us-east-1 \
    --web-acl-arn "$acl_arn" \
    --rule-metric-name "${METRIC_PREFIX}_${rule}" \
    --scope CLOUDFRONT \
    --time-window StartTime="$(ago 10800)",EndTime="$(ago 0)" \
    --max-items 100 \
    | jq -r '.SampledRequests[] | [.Timestamp, .Action, .Request.ClientIP, .Request.Country, .Request.Method, .Request.URI, (.RuleNameWithinRuleGroup // "-")] | @tsv' \
    | column -t -s $'\t' || true
  echo
  echo "列: 時刻 / 動作 / IP / 国 / メソッド / URL / 該当したサブルール"
  echo "サブルール名が誤検知なら infra/lib/waf-stack.ts の ruleActionOverrides に追加して count に落とせます。"
}

backup_status() {
  local since
  since="$(ago $(( 7 * 86400 )))"
  echo "== バックアップジョブ (直近 7 日) =="
  aws backup list-backup-jobs --region "$REGION" --by-backup-vault-name "$VAULT" --by-created-after "$since" \
    --query 'BackupJobs[].[CreationDate,State,ResourceType,StatusMessage]' --output table || true
  echo "== 大阪へのコピージョブ (直近 7 日) =="
  aws backup list-copy-jobs --region "$REGION" --by-created-after "$since" \
    --query 'CopyJobs[].[CreationDate,State,DestinationBackupVaultArn]' --output table || true
  echo "== 復元ジョブ (直近 60 日, 自動復元テスト含む) =="
  aws backup list-restore-jobs --region "$REGION" --by-created-after "$(ago $(( 60 * 86400 )))" \
    --query 'RestoreJobs[].[CreationDate,Status,ValidationStatus,CreatedResourceArn,StatusMessage]' --output table || true
  echo "== 復旧ポイント数 =="
  echo -n "  東京 ${VAULT}: "
  aws backup list-recovery-points-by-backup-vault --region "$REGION" --backup-vault-name "$VAULT" \
    --query 'length(RecoveryPoints)' --output text || true
  echo -n "  大阪 ${COPY_VAULT}: "
  aws backup list-recovery-points-by-backup-vault --region "$COPY_REGION" --backup-vault-name "$COPY_VAULT" \
    --query 'length(RecoveryPoints)' --output text || true
}

restore_test_now() {
  # 最新の復旧ポイントを、本番と同じ閉じたネットワークに最小サイズで一時復元する。
  # 本番 DB には一切影響しない。確認後に自分で削除する (下に削除コマンドを表示)。
  local rp
  rp="$(aws backup list-recovery-points-by-backup-vault --region "$REGION" --backup-vault-name "$VAULT" \
    --query 'sort_by(RecoveryPoints[?Status==`COMPLETED`], &CreationDate)[-1].RecoveryPointArn' --output text)"
  [ -n "$rp" ] && [ "$rp" != "None" ] || { echo "復旧ポイントがまだありません (初回バックアップは JST 05:00)" >&2; exit 1; }

  local subnet_group sg role_arn
  subnet_group="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID" \
    --query 'DBInstances[0].DBSubnetGroup.DBSubnetGroupName' --output text)"
  sg="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID" \
    --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' --output text)"
  role_arn="$(aws backup list-restore-testing-selections --region "$REGION" \
    --restore-testing-plan-name "$(echo "${APP}-${ENV}-restore-test" | tr '-' '_')" \
    --query 'RestoreTestingSelections[0].IamRoleArn' --output text 2>/dev/null || true)"
  [ -n "$role_arn" ] && [ "$role_arn" != "None" ] || { echo "復元用ロールが見つかりません (*-backup スタックをデプロイしてください)" >&2; exit 1; }

  local target
  target="restore-test-$(date '+%Y%m%d%H%M')"
  echo "復旧ポイント: $rp"
  echo "復元先 DB  : $target (db.t3.micro / 非公開 / 本番と同じ isolated サブネット)"
  local meta
  meta="$(jq -nc --arg id "$target" --arg sng "$subnet_group" --arg sg "$sg" \
    '{DBInstanceIdentifier:$id, DBSubnetGroupName:$sng, VpcSecurityGroupIds:([$sg]|tojson), DBInstanceClass:"db.t3.micro", MultiAZ:"false", PubliclyAccessible:"false", DeletionProtection:"false"}')"
  local job
  job="$(aws backup start-restore-job --region "$REGION" \
    --recovery-point-arn "$rp" --iam-role-arn "$role_arn" --resource-type RDS \
    --metadata "$meta" --query RestoreJobId --output text)"
  cat <<EOF

復元ジョブを開始しました: $job  (完了まで 10〜30 分。結果はメールでも届きます)
  進捗確認: aws backup describe-restore-job --region $REGION --restore-job-id $job --query '[Status,StatusMessage]'
  完了後、行数を確認する例 (EC2 上で。パスワードは本番と同じ):
    psql "postgresql://idol_admin:<password>@<$target のエンドポイント>:5432/idol_fansite?sslmode=require" \\
      -c "SELECT count(*) FROM users;"
  ⚠️ 確認が終わったら必ず削除 (放置すると課金が続きます):
    aws rds delete-db-instance --region $REGION --db-instance-identifier $target --skip-final-snapshot --delete-automated-backups
EOF
}

vault_lock_status() {
  for pair in "$REGION:$VAULT" "$COPY_REGION:$COPY_VAULT"; do
    local r="${pair%%:*}" v="${pair#*:}"
    echo "== $v ($r) =="
    aws backup describe-backup-vault --region "$r" --backup-vault-name "$v" \
      --query '{Locked:Locked, MinRetentionDays:MinRetentionDays, MaxRetentionDays:MaxRetentionDays, LockDate:LockDate, RecoveryPoints:NumberOfRecoveryPoints}' \
      --output table || true
  done
  echo "LockDate が空 → governance モード (管理者が解除可能)"
  echo "LockDate が未来 → compliance の猶予期間中 (この日時までは取り消し可能)"
  echo "LockDate が過去 → compliance 確定 (誰も解除不可)"
}

cmd="${1:-}"
shift || true
case "$cmd" in
  waf-report) waf_report "$@" ;;
  waf-samples) waf_samples "$@" ;;
  backup-status) backup_status ;;
  restore-test-now) restore_test_now ;;
  vault-lock-status) vault_lock_status ;;
  *)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
