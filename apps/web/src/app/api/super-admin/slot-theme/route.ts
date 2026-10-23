/**
 * GET   /api/super-admin/slot-theme — スロットの見た目テーマ (auto/default/halloween) を取得
 * PATCH /api/super-admin/slot-theme — テーマを変更 (永続化)
 *
 * SUPER_ADMIN 限定。値は AppSetting (slot.theme) に保存される。
 * テーマは表示 (絵柄・文言・配色) だけを変え、確率・配当には影響しない。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SlotThemeModeSchema, resolveSlotTheme } from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getSlotThemeMode, setSlotThemeMode } from '@/lib/app-setting';

export const runtime = 'nodejs';

const BodySchema = z.object({ mode: SlotThemeModeSchema });

export const GET = handle(async () => {
  await requireSuperAdminView();
  const mode = await getSlotThemeMode();
  return NextResponse.json({ mode, activeTheme: resolveSlotTheme(mode) });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('テーマの指定が不正です (auto / default / halloween)');
  }

  const prev = await getSlotThemeMode();
  const mode = await setSlotThemeMode(parsed.data.mode);

  await logAudit({
    userId: session.user.id,
    action: 'setting.slot_theme_update',
    resource: 'setting:slot.theme',
    metadata: { from: prev, to: mode },
  });

  return NextResponse.json({ ok: true, mode, activeTheme: resolveSlotTheme(mode) });
});
