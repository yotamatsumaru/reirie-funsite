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
 *   ?check=1         入室条件だけ確認して 204 / 403 等を返す (ルームには入らない)
 *
 * 入室条件 (lib/call-access.ts):
 *   - 特典会ルーム `event:<id>`: 演者は CALL 権限、ファンは本ルームに呼ばれているチケット本人
 *     (終了・中止イベントは誰も入れない / ファンは DONE・NO_SHOW になった時点で切断)
 *   - 1on1 ルーム `<演者 userId>`: 演者はルームの持ち主本人、ファンは会員 (スタンダード以上) か運営
 */
import { resolveApiSession } from '@/lib/api-auth';
import { tryJoinRoom, type CallRole, type SignalEvent } from '@/lib/call-hub';
import { checkCallRoomAccess, isFanStillInMainRoom } from '@/lib/call-access';
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

  // 入室可否 (lib/call-access.ts)。従来はログインさえしていれば誰でも任意のルームに入れた
  const decision = await checkCallRoomAccess(
    roomId,
    {
      userId: session.user.id,
      role: session.user.role,
      plan: session.user.plan,
      capabilities: session.user.capabilities ?? [],
    },
    role,
  );
  if (!decision.ok) {
    return new Response(decision.message, {
      status: decision.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // 入室前の確認だけ (CallRoom が EventSource を開く前に呼ぶ)。ルームには入らない
  if (url.searchParams.get('check') === '1') {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const userId = session.user.id;
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

      const joined = tryJoinRoom(roomId, { clientId, userId, role, send });
      if (!joined.ok) {
        // 上限超過: 理由を 1 回だけ送って切断する
        safeEnqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ reason: joined.reason })}\n\n`));
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
        return;
      }
      const leave = joined.leave;

      // keep-alive
      const keepAlive = setInterval(() => {
        send({ type: 'ping' });
      }, 15000);

      // ファンは通話が終わった (スタッフが「次へ」を押した) 時点でルームから追い出す。
      // これをしないと、DONE になった人が接続を張ったまま次の人の通話に居座れる。
      const ticketId = decision.ticketId;
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
