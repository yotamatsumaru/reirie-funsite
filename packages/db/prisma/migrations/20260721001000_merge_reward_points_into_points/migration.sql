-- DataMigration
-- Fan ポイントと特典ポイントの統合 (2026-07)。
--
-- 既存ユーザーの特典ポイント残高 (users.reward_points) を Fan ポイント残高
-- (users.points) へ無条件に合算する。合算した分は PointTransaction に
-- reason = 'MERGE_ADJUST' の台帳エントリとして記録し、監査証跡を残す。
--
-- 前提: このマイグレーションは PointReason enum に 'MERGE_ADJUST' が
-- 追加された後 (20260721000400_add_point_reason_merge_adjust) に適用されること。
--
-- reward_points = 0 のユーザーは合算不要のため対象から除外する
-- (台帳エントリも作成しない)。

-- 1) 台帳エントリを作成 (合算前の reward_points を amount として記録し、
--    balance には合算後の Fan ポイント残高を記録する)
INSERT INTO "point_transactions" ("id", "user_id", "amount", "balance", "reason", "note", "created_at")
SELECT
  gen_random_uuid(),
  "id",
  "reward_points",
  "points" + "reward_points",
  'MERGE_ADJUST',
  '特典ポイント統合による Fan ポイントへの残高付け替え (旧 reward_points: ' || "reward_points" || 'pt)',
  CURRENT_TIMESTAMP
FROM "users"
WHERE "reward_points" != 0;

-- 2) users.points に reward_points を合算する
UPDATE "users"
SET "points" = "points" + "reward_points"
WHERE "reward_points" != 0;
