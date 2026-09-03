/**
 * GET   /api/super-admin/contact-notification — お問い合わせ通知設定を取得
 * PATCH /api/super-admin/contact-notification — 通知設定を更新 (即時反映)
 *
 * SUPER_ADMIN 限定。値は AppSetting (contact.notification) に永続化される。
 *
 * 【この設定が何を制御するか】
 *  - ackMailEnabled     : 送信者本人への「送信内容の控え」メール
 *  - adminNotifyEnabled : 運営への「新規問い合わせが届きました」通知メール
 *  - adminEmails        : 運営通知の宛先 (空なら通知は送られない)
 *
 * 運営通知の宛先を DB (AppSetting) に置いているのは、環境変数だと
 * 変更のたびに再デプロイが必要になり、担当者の異動・追加に追随できないため。
 */
import { NextResponse } from 'next/server';
import { ContactNotificationSettingsSchema, normalizeAdminEmails } from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  getContactNotificationSettings,
  setContactNotificationSettings,
} from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const settings = await getContactNotificationSettings();
  return NextResponse.json({ settings });
});

const PatchSchema = ContactNotificationSettingsSchema.partial();

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') {
    throw errors.badRequest('リクエスト形式が不正です');
  }

  // 宛先はバリデーション前に正規化する。管理画面はテキストエリア入力なので
  // 「末尾に空行が残っている」「大文字混在」を弾いてしまうと使いづらい。
  const payload = { ...raw };
  if (Array.isArray(payload.adminEmails)) {
    payload.adminEmails = normalizeAdminEmails(payload.adminEmails.map((v) => String(v)));
  }

  const parsed = PatchSchema.safeParse(payload);
  if (!parsed.success) {
    // 宛先のメール形式エラーなどは運営に理由が伝わるよう本文に載せる。
    const first = parsed.error.issues[0];
    throw errors.unprocessable(first?.message ?? '入力値が不正です');
  }

  const { before, after } = await setContactNotificationSettings(parsed.data);

  await logAudit({
    userId: session.user.id,
    action: 'setting.contact_notification_update',
    resource: 'setting:contact.notification',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: { from: before, to: after },
  });

  return NextResponse.json({ settings: after });
});
