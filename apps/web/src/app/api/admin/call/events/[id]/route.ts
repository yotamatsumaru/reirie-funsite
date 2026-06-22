/**
 * 管理者用 特典会イベント詳細 API
 *  - GET   : 詳細 (キュー込み)
 *  - PATCH : 更新 (status / 各種フィールド)
 *  - DELETE: 物理削除 (キャンセル時)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireAdmin } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { UpdateCallEventSchema } from '@idol/shared';

export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export const GET = handle(async (_req, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const event = await prisma.callEvent.findUnique({
    where: { id },
    include: {
      performer: { select: { id: true, email: true, displayName: true, role: true } },
      _count: { select: { serials: true, tickets: true } },
    },
  });
  if (!event) throw errors.notFound('イベントが見つかりません');

  // チケット一覧 (queuePos 順)
  const tickets = await prisma.callTicket.findMany({
    where: { eventId: id },
    orderBy: { queuePos: 'asc' },
    include: {
      user: { select: { id: true, email: true, displayName: true } },
    },
  });

  // 未使用シリアル数も返す
  const unusedSerialCount = await prisma.callSerial.count({
    where: { eventId: id, usedById: null },
  });

  return NextResponse.json({ event, tickets, unusedSerialCount });
});

export const PATCH = handle(async (req, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const body = await req.json();
  const input = UpdateCallEventSchema.parse(body);

  const existing = await prisma.callEvent.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('イベントが見つかりません');

  const updated = await prisma.callEvent.update({
    where: { id },
    data: {
      title: input.title ?? undefined,
      description: input.description === undefined ? undefined : input.description,
      noticeText: input.noticeText === undefined ? undefined : input.noticeText,
      performerId: input.performerId ?? undefined,
      startsAt: input.startsAt ?? undefined,
      endsAt: input.endsAt === undefined ? undefined : input.endsAt,
      perFanSeconds: input.perFanSeconds ?? undefined,
      status: input.status ?? undefined,
    },
  });
  return NextResponse.json({ event: updated });
});

export const DELETE = handle(async (_req, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const existing = await prisma.callEvent.findUnique({
    where: { id },
    include: { _count: { select: { tickets: true } } },
  });
  if (!existing) throw errors.notFound('イベントが見つかりません');

  // チケットが既に発行されている場合は status=CANCELED に倒すだけ (履歴は残す)
  if (existing._count.tickets > 0) {
    const updated = await prisma.callEvent.update({
      where: { id },
      data: { status: 'CANCELED' },
    });
    return NextResponse.json({ event: updated, mode: 'soft-cancel' });
  }

  // チケット 0 件ならハード削除
  await prisma.callEvent.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
});
