/**
 * 「呼んでほしい名前」設定 API
 *
 * PUT /api/me/profile/preferred-name — REIRIE に呼んでほしい名前を更新
 *   - 空文字を送ると解除 (null) になる。
 *   - DM の @ メンションでこの名前が展開される。
 */
import { NextResponse } from 'next/server';
import { UpdatePreferredNameSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { updatePreferredName } from '@/lib/dm';

export const runtime = 'nodejs';

export const PUT = handle(async (req: Request) => {
  const session = await requireApiSession(req);

  const json = (await req.json().catch(() => null)) as
    | { preferredName?: unknown }
    | null;
  const parsed = UpdatePreferredNameSchema.safeParse(json ?? {});
  if (!parsed.success) {
    throw errors.unprocessable('名前が不正です', parsed.error.flatten());
  }

  const value = await updatePreferredName(session.user.id, parsed.data.preferredName);
  return NextResponse.json({ preferredName: value });
});
