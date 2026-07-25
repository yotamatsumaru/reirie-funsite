/**
 * GET   /api/super-admin/dm-ng-words — 現在の DM NG ワード一覧を取得
 * PATCH /api/super-admin/dm-ng-words — NG ワード一覧を更新 (永続化)
 *
 * SUPER_ADMIN 限定。値は AppSetting (dm.ngWords) に JSON 配列で永続化される。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getNgWords, setNgWords } from '@/lib/dm';

export const runtime = 'nodejs';

const UpdateNgWordsSchema = z.object({
  ngWords: z.array(z.string().max(50)).max(500),
});

export const GET = handle(async () => {
  await requireSuperAdminView();
  const ngWords = await getNgWords();
  return NextResponse.json({ ngWords });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = UpdateNgWordsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const prev = await getNgWords();
  const next = await setNgWords(parsed.data.ngWords);

  await logAudit({
    userId: session.user.id,
    action: 'setting.dm_ng_words_update',
    resource: 'setting:dm.ngWords',
    metadata: { from: prev, to: next },
  });

  return NextResponse.json({ ok: true, ngWords: next });
});
