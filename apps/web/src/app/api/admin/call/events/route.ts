/**
 * 管理者用 特典会イベント API
 *  - GET  : イベント一覧 (新しい順)
 *  - POST : イベント作成
 *
 * 認可: ADMIN または SUPER_ADMIN のみ。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { CreateCallEventSchema } from '@idol/shared';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireCapability('CALL');
  const events = await prisma.callEvent.findMany({
    orderBy: { startsAt: 'desc' },
    include: {
      performer: { select: { id: true, email: true, displayName: true, role: true } },
      _count: { select: { serials: true, tickets: true } },
    },
  });
  return NextResponse.json({ events });
});

export const POST = handle(async (req) => {
  await requireCapability('CALL');
  const body = await req.json();
  const input = CreateCallEventSchema.parse(body);

  // performerId が ADMIN または SUPER_ADMIN であることを確認 (一般 USER をアイドル役にしない)
  const performer = await prisma.user.findUnique({
    where: { id: input.performerId },
    select: { id: true, role: true },
  });
  if (!performer) {
    throw errors.notFound('指定された演者ユーザーが見つかりません');
  }
  if (performer.role !== 'ADMIN' && performer.role !== 'SUPER_ADMIN') {
    throw errors.badRequest('演者には管理者ロールのユーザーを指定してください');
  }

  const created = await prisma.callEvent.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      noticeText: input.noticeText ?? null,
      performerId: input.performerId,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      perFanSeconds: input.perFanSeconds,
    },
  });
  return NextResponse.json({ event: created }, { status: 201 });
});
