-- 神経衰弱 (MEMORY) ミニゲームの追加
--
-- 1. MiniGameType に MEMORY を追加
--    既存の 1 日回数制限 / 追加プレイ購入 / プレイ履歴の仕組みを
--    そのまま流用するため、新しい enum 値として足す。
ALTER TYPE "MiniGameType" ADD VALUE IF NOT EXISTS 'MEMORY';

-- 2. 進行中セッションのテーブル
--
--    盤面 (どの位置にどの写真があるか) はここにのみ保存する。
--    クライアントに返すとレスポンスを見るだけで全カードの位置が判明し、
--    ノーミスで Pui を稼げてしまうため。
--
--    user_id に UNIQUE を張り、1 ユーザーが同時に複数の盤面を
--    持てないようにしている (良い盤面を引くまで開き直す / 並行プレイで
--    1 日の回数制限を回避する、を防ぐ)。
CREATE TABLE IF NOT EXISTS "memory_game_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "board" TEXT NOT NULL,
    "matched_indexes" TEXT NOT NULL DEFAULT '[]',
    "first_pick" INTEGER,
    "moves" INTEGER NOT NULL DEFAULT 0,
    "counted" BOOLEAN NOT NULL DEFAULT true,
    "date" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_game_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "memory_game_sessions_user_id_key"
    ON "memory_game_sessions"("user_id");

-- 期限切れセッションの掃除用
CREATE INDEX IF NOT EXISTS "memory_game_sessions_started_at_idx"
    ON "memory_game_sessions"("started_at");

DO $$
BEGIN
  ALTER TABLE "memory_game_sessions"
    ADD CONSTRAINT "memory_game_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
