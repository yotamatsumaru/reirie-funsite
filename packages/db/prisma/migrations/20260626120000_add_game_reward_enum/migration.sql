-- AlterEnum: ミニゲーム勝利報酬を PointReason に追加
-- 注意: 新しい enum 値は同一トランザクション内では利用できないため、
--       テーブル作成とは別マイグレーションに分離している。
ALTER TYPE "PointReason" ADD VALUE 'GAME_REWARD';
