/**
 * POST /api/admin/contents/preview
 *
 * 記事編集画面の「プレビュー」タブ用。本文 HTML を保存時と同じ
 * sanitizeContentBody() に通した結果を返す。
 *
 * 以前はプレビューで入力中の HTML をそのまま描画していたため、
 * HTML タブに貼り付けた <script> や onerror 属性が管理画面上で実行されうる状態だった
 * (他人が用意した HTML をコピペさせる手口で管理者のセッションを悪用される)。
 * sanitize-html はブラウザに載せると重いので、サーバー側で整形して返す。
 *
 * Body: { body: string }  → { html: string }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCapability } from '@/auth';
import { handle } from '@/lib/errors';
import { sanitizeContentBody } from '@/lib/sanitize-html';

export const runtime = 'nodejs';

/** 本文の上限 (保存側のスキーマより十分大きく、巨大リクエストは弾く) */
const MAX_BODY_CHARS = 2_000_000;

const PreviewSchema = z.object({
  body: z.string().max(MAX_BODY_CHARS),
});

export const POST = handle(async (req: Request) => {
  await requireCapability('CONTENT');
  const { body } = PreviewSchema.parse(await req.json());
  return NextResponse.json(
    { html: sanitizeContentBody(body) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
