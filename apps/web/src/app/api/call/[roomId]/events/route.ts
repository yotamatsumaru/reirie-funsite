/**
 * GET /api/call/[roomId]/events
 *
 * SSE (Server-Sent Events) でシグナリングメッセージを受信する。
 *
 * クライアントは EventSource でこのエンドポイントに接続し、
 * - `hello` … 自分の clientId と既存ピア一覧
 * - `peer-joined` … 別ピアが入室
 * - `peer-left` … 別ピアが退室
 * - `signal` … offer / answer / ice candidate
 * - `ping` … keep-alive (15 秒ごと)
 *
 * のイベントを受け取る。
 *
 * クエリ:
 *   ?role=performer  (演者側) or ?role=fan (ファン側)
 *
 * 認可 (lib/call-room-access.ts):
 *   - roomId は `event:{eventId}` のみ
 *   - performer: 通話管理権限 (CALL)
 *   - fan: 自分のチケットが IN_MAIN_ROOM (呼ばれた本人のみ)。DONE/NO_SHOW になると切断
 */
import { resolveApiSession } from '@/lib/api-auth';
import { joinRoom, type CallRole, type SignalEvent } from '@/lib/call-hub';
import { checkCallRoomAccess, isFanStillInMainRoom } from '@/lib/call-room-access';
import { randomUUID } from 'crypto';

/** ファンの «まだ自分の番か» を確認する間隔。DONE/NO_SHOW になったら切断する */
const FAN_RECHECK_MS = 3000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const session = await resolveApiSession(req);
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const role: CallRole = url.searchParams.get('role') === 'performer' ? 'performer' : 'fan';

  // 入室可否: 演者=通話管理権限 / ファン=自分のチケットが IN_MAIN_ROOM
  // (従来はログインさえしていれば誰でも任意のルームに入れた)
  const access = await checkCallRoomAccess(session, roomId, role);
  if (!access.ok) {
    return new Response(`Forbidden: ${access.reason}`, { status: access.status });
  }

  const clientId = randomUUID();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      const send = (event: SignalEvent) => {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        safeEnqueue(encoder.encode(data));
      };

      // 先頭にコメント行を入れて Nginx 等のバッファをフラッシュ
      safeEnqueue(encoder.encode(`: connected ${clientId}\n\n`));

      const leave = joinRoom(roomId, { clientId, userId: session.user.id, role, send });

      // keep-alive
      const keepAlive = setInterval(() => {
        send({ type: 'ping' });
      }, 15000);

      // ファンは通話が終わった (スタッフが「次へ」を押した) 時点でルームから追い出す。
      // これをしないと、DONE になった人が接続を張ったまま次の人の通話に居座れる。
      const ticketId = access.ticketId;
      const recheck =
        role === 'fan' && ticketId
          ? setInterval(async () => {
              try {
                if (!(await isFanStillInMainRoom(ticketId))) onAbort();
              } catch {
                // DB の一時的な失敗では切断しない (次の周期で再確認)
              }
            }, FAN_RECHECK_MS)
          : null;

      let aborted = false;
      function onAbort() {
        if (aborted) return;
        aborted = true;
        clearInterval(keepAlive);
        if (recheck) clearInterval(recheck);
        leave();
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }

      req.signal.addEventListener('abort', onAbort);
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
