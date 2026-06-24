/**
 * POST /api/admin/call/events/[id]/next
 *
 * 「次のファンを本ルームへ呼ぶ」 — スタッフが操作する司令塔ボタン。
 *
 * 動作:
 *   1. closeCurrent=true (デフォルト) なら現在 IN_MAIN_ROOM の人を DONE に
 *   2. キューから先頭の WAITING/IN_WAITING_ROOM 該当者を取得 (queuePos 昇順)
 *   3. その人の status を IN_MAIN_ROOM に変更し enteredMainAt を記録
 *   4. 該当者がいなければ "no-more" を返す
 *
 * 排他制御:
 *   $transaction で囲み、同一イベントで一度に IN_MAIN_ROOM のチケットが
 *   複数発生しないよう保証する。
 *
 * 認可: ADMIN 以上 (アイドル横のスタッフ操作)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { CallNextFanSchema } from '@idol/shared';

export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export const POST = handle(async (req, ctx: Ctx) => {
  await requireCapability('CALL');
  const { id: eventId } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const input = CallNextFanSchema.parse(body);

  const event = await prisma.callEvent.findUnique({ where: { id: eventId } });
  if (!event) throw errors.notFound('イベントが見つかりません');
  if (event.status === 'CANCELED' || event.status === 'ENDED') {
    throw errors.badRequest('このイベントは既に終了/キャンセルされています');
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    let closed: { id: string; queuePos: number } | null = null;

    // 1. 現在本ルームに居る人を閉じる
    if (input.closeCurrent) {
      const current = await tx.callTicket.findFirst({
        where: { eventId, status: 'IN_MAIN_ROOM' },
        orderBy: { queuePos: 'asc' },
      });
      if (current) {
        await tx.callTicket.update({
          where: { id: current.id },
          data: { status: 'DONE', endedAt: now },
        });
        closed = { id: current.id, queuePos: current.queuePos };
      }
    }

    // 2. 次の人を選出 (WAITING/IN_WAITING_ROOM のうち最も若い queuePos)
    const next = await tx.callTicket.findFirst({
      where: {
        eventId,
        status: { in: ['WAITING', 'IN_WAITING_ROOM'] },
      },
      orderBy: { queuePos: 'asc' },
    });

    if (!next) {
      // 次に呼ぶ人が居ない。
      // 「現行を閉じた直後で誰も残っていない」もしくは「もう全員終わっている」状態。
      // この場合は自動的にイベント自体を ENDED にする (スタッフが何度も「終了」を押さなくて良いように)。
      // 既に ENDED/CANCELED ならスキップ。
      let endedNow = false;
      if (event.status !== 'ENDED' && event.status !== 'CANCELED') {
        await tx.callEvent.update({
          where: { id: eventId },
          data: { status: 'ENDED' },
        });
        endedNow = true;
      }
      return { closed, next: null, endedNow };
    }

    const updated = await tx.callTicket.update({
      where: { id: next.id },
      data: { status: 'IN_MAIN_ROOM', enteredMainAt: now },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
      },
    });

    // イベント状態が SCHEDULED のままなら LIVE に進める
    if (event.status === 'SCHEDULED') {
      await tx.callEvent.update({ where: { id: eventId }, data: { status: 'LIVE' } });
    }

    return { closed, next: updated, endedNow: false };
  });

  return NextResponse.json(result);
});
