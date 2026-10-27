-- お知らせにチケットサイトの申込タグ (Ticket Dive のルート限定タグ等) を埋め込めるようにする。
-- 本文 (body) はプレーンテキストのまま、サニタイズ済み HTML を別カラムに保存する。
-- 追加のみ (NULL 許容) なので既存データには影響しない。
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "embed_html" TEXT;
