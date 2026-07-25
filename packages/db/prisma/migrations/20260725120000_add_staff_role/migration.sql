-- スタッフ管理者ロールを追加
-- SUPER_ADMIN と同じ管理画面を閲覧できるが、返金/BAN などの書き込み操作は不可 (read-only)。
-- Postgres の enum への値追加。SUPER_ADMIN の前に配置してランク順を維持する。
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'STAFF' BEFORE 'SUPER_ADMIN';
