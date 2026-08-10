-- スロットミニゲームの追加。
--
-- 既存の mini_game_plays / mini_game_extra_play_purchases テーブルをそのまま流用し、
-- game_type に 'SLOT' を足すだけで済むようにしている。
-- (新テーブルを作らないので、プレイ履歴・追加プレイ購入・Pui 整合性チェックなど
--  既存の仕組みがすべてスロットにもそのまま効く)
--
-- ALTER TYPE ... ADD VALUE は既存の行に影響しない安全な操作。
-- IF NOT EXISTS 付きなので、再実行しても失敗しない (冪等)。
ALTER TYPE "MiniGameType" ADD VALUE IF NOT EXISTS 'SLOT';
