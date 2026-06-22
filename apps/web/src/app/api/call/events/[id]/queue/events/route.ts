/**
 * GET /api/call/events/[id]/queue/events  (Server-Sent Events)
 *
 * 待機キューの状態をクライアントへ Push する SSE エンドポイント。
 *
 * 配信内容 (CallQueueSnapshot):
 *   - event.status (SCHEDULED/LIVE/ENDED/CANCELED)
 *   - 現在本ルームに居る人 (queuePos / 表示名)
 *   - リクエスト者のチケット (位置 / 自分より前の未処理人数)
 *
 * 配信頻度: 2 秒に 1 回 (polling-over-SSE)。
 *  - 真のリアルタイム push にする場合は pub/sub が必要だが、200 人規模 + 2 秒間隔なら DB ポーリングで十分。
 *  - 接続切断時はクライアント側 EventSource が自動再接続する。
 *
 * 認可:
 *   - 自分のチケットを見るには login が必須。ただし、ログイン無しでもイベント概要は返す
 *     (チケット未引換状態でも「現在 N 番終了」を表示できるようにするため)。
 *
 * 注意 (Vercel/Cloudflare 等のデプロイ環境):
 *   Node.js ランタイム + standalone モードで動作することを前提とする。
 */
import { auth } from '@/auth';
import { prisma } from '@idol/db';
import type { CallQueueSnapshot } from '@idol/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 2000;
const PING_INTERVAL_MS = 15000;

interface Ctx {
  params: Promise<{ id: string }>;
}

async function buildSnapshot(eventId: string, userId: string | undefined): Promise<CallQueueSnapshot | null> {
  const event = await prisma.callEvent.findUnique({
    where: { id: eventId },
    select: { id: true, status: true },
  });
  if (!event) return null;

  const currentTicket = await prisma.callTicket.findFirst({
    where: { eventId, status: 'IN_MAIN_ROOM' },
    orderBy: { queuePos: 'asc' },
    include: { user: { select: { displayName: true } } },
  });

  let me: CallQueueSnapshot['me'] = null;
  if (userId) {
    const ticket = await prisma.callTicket.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });
    if (ticket) {
      // 自分より前で未処理 (WAITING/IN_WAITING_ROOM) の人数
      const aheadCount = await prisma.callTicket.count({
        where: {
          eventId,
          queuePos: { lt: ticket.queuePos },
          status: { in: ['WAITING', 'IN_WAITING_ROOM'] },
        },
      });
      me = {
        ticketId: ticket.id,
        queuePos: ticket.queuePos,
        status: ticket.status,
        aheadCount,
      };
    }
  }

  return {
    eventId,
    status: event.status,
    current: currentTicket
      ? {
          ticketId: currentTicket.id,
          queuePos: currentTicket.queuePos,
          displayName: currentTicket.user.displayName,
          enteredMainAt: currentTicket.enteredMainAt
            ? currentTicket.enteredMainAt.toISOString()
            : null,
        }
      : null,
    me,
  };
}

export async function GET(req: Request, ctx: Ctx) {
  const { id: eventId } = await ctx.params;
  const session = await auth();
  const userId = session?.user?.id;

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // 既に閉じられている
        }
      };

      // initial snapshot
      const initial = await buildSnapshot(eventId, userId);
      if (!initial) {
        safeEnqueue(`event: error\ndata: ${JSON.stringify({ message: 'event not found' })}\n\n`);
        controller.close();
        return;
      }
      safeEnqueue(`event: snapshot\ndata: ${JSON.stringify(initial)}\n\n`);

      let lastJson = JSON.stringify(initial);
      const poll = setInterval(async () => {
        if (cancelled) return;
        try {
          const snap = await buildSnapshot(eventId, userId);
          if (!snap) return;
          const json = JSON.stringify(snap);
          if (json !== lastJson) {
            lastJson = json;
            safeEnqueue(`event: snapshot\ndata: ${json}\n\n`);
          }
        } catch (err) {
          console.error('[call-queue-sse] poll error', err);
        }
      }, POLL_INTERVAL_MS);

      // keep-alive
      const ping = setInterval(() => {
        if (cancelled) return;
        safeEnqueue(`: ping ${Date.now()}\n\n`);
      }, PING_INTERVAL_MS);

      const abort = () => {
        cancelled = true;
        clearInterval(poll);
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener('abort', abort);
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
