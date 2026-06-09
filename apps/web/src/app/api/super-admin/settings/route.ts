/**
 * PATCH /api/super-admin/settings
 *   - SUPER_ADMIN 限定: システム設定値を更新
 *
 * body: { key: string, value: string | number | boolean }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getSetting, updateSetting } from '@/lib/demo-store';

export const runtime = 'nodejs';

const Schema = z.object({
  key: z.string().min(1).max(100),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }
  const { key, value } = parsed.data;

  const prev = getSetting(key);
  if (!prev) {
    throw errors.notFound('指定したキーの設定が見つかりません');
  }
  // 型整合チェック
  if (typeof prev.value !== typeof value) {
    throw errors.unprocessable(
      `value の型が不正です (期待: ${typeof prev.value}, 受信: ${typeof value})`,
    );
  }

  const next = updateSetting(key, value);
  if (!next) {
    throw errors.notFound('設定の更新に失敗しました');
  }

  await logAudit({
    userId: session.user.id,
    action: 'setting.update',
    resource: `setting:${key}`,
    metadata: { key, from: prev.value, to: value },
  });

  return NextResponse.json({ ok: true, setting: next });
});
