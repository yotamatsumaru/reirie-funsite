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
 */
import { resolveApiSession } from '@/lib/api-auth';
import { joinRoom, type CallRole, type SignalEvent } from '@/lib/call-hub';
import { randomUUID } from 'crypto';

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
  const roleParam = url.searchParams.get('role');
  let role: CallRole;
  if (roleParam === 'performer') {
    if (session.user.role !== 'ADMIN' && session.user.role !== 'SUPER_ADMIN') {
      return new Response('Forbidden: performer role requires ADMIN', { status: 403 });
    }
    role = 'performer';
  } else {
    role = 'fan';
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

      const leave = joinRoom(roomId, { clientId, role, send });

      // keep-alive
      const keepAlive = setInterval(() => {
        send({ type: 'ping' });
      }, 15000);

      const onAbort = () => {
        clearInterval(keepAlive);
        leave();
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

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
