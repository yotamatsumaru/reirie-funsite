/**
 * POST /api/super-admin/announcements
 *   - SUPER_ADMIN 限定: お知らせを新規作成
 *
 * body: { title, body, audience, status, sendEmail }
 *
 * status=PUBLISHED かつ sendEmail=true で作成した場合、作成直後に
 * 会員への一斉メール送信をバックグラウンドでキックする
 * (fire-and-forget。HTTP レスポンスは送信完了を待たずに返す)。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendAnnouncementEmails, shouldTriggerEmail } from '@/lib/bulk-email';
import { ANNOUNCEMENT_AUDIENCES } from '@/lib/announcement-audience';

export const runtime = 'nodejs';

const Schema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  // 配信対象の一覧は announcement-audience.ts から取る。
  // ここに直接 union を書くと対象を追加したときに 422 になる。
  audience: z.enum(ANNOUNCEMENT_AUDIENCES),
  status: z.enum(['DRAFT', 'PUBLISHED']),
  sendEmail: z.boolean().optional().default(false),
});

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const json = (await req.json().catch(() => ({}))) as unknown;
  const parsed = Schema.safeParse(json);
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const now = new Date();
  const created = await prisma.announcement.create({
    data: {
      title: parsed.data.title,
      body: parsed.data.body,
      audience: parsed.data.audience,
      status: parsed.data.status,
      sendEmail: parsed.data.sendEmail,
      emailStatus: parsed.data.sendEmail && parsed.data.status === 'PUBLISHED' ? 'PENDING' : 'NOT_REQUESTED',
      publishedAt: parsed.data.status === 'PUBLISHED' ? now : null,
      authorId: session.user.id,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'announcement.create',
    resource: `announcement:${created.id}`,
    metadata: {
      title: created.title,
      audience: created.audience,
      status: created.status,
      sendEmail: created.sendEmail,
    },
  });

  if (shouldTriggerEmail(created)) {
    // レスポンスを待たせないよう fire-and-forget で実行 (失敗しても本処理には影響しない)
    void sendAnnouncementEmails(created.id);
  }

  return NextResponse.json({ ok: true, announcement: created });
});
