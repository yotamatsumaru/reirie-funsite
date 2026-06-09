/**
 * POST /api/super-admin/announcements
 *   - SUPER_ADMIN 限定: お知らせを新規作成
 *
 * body: { title, body, audience, status }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { createAnnouncement } from '@/lib/demo-store';

export const runtime = 'nodejs';

const Schema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  audience: z.enum(['ALL', 'MEMBERS', 'PREMIUM']),
  status: z.enum(['DRAFT', 'PUBLISHED']),
});

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const json = (await req.json().catch(() => ({}))) as unknown;
  const parsed = Schema.safeParse(json);
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const created = createAnnouncement({
    title: parsed.data.title,
    body: parsed.data.body,
    audience: parsed.data.audience,
    status: parsed.data.status,
    authorId: session.user.id,
  });

  await logAudit({
    userId: session.user.id,
    action: 'announcement.create',
    resource: `announcement:${created.id}`,
    metadata: {
      title: created.title,
      audience: created.audience,
      status: created.status,
    },
  });

  return NextResponse.json({ ok: true, announcement: created });
});
