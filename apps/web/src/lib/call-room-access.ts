/**
 * call-room-access — 1on1 通話ルーム (シグナリング) への入室可否判定
 *
 * 【なぜ必要か】
 * 従来の /api/call/[roomId]/events と /signal は «ログインしているか» しか見ておらず、
 *   - 任意の会員が roomId (`event:{eventId}`) を指定すれば、他人の通話ルームに
 *     ファンとして入室できた (= 演者から offer が飛んできて、映像・音声を受信できる)
 *   - 通話を終えた (DONE) / スキップされた (NO_SHOW) ファンも、接続を切らない限り
 *     ルームに残り続けられた
 * という «盗み見・割り込み» が可能な状態だった。
 *
 * ここでは «このユーザーが、この役割で、このルームに居てよいか» を一元的に判定する。
 *
 * 【ルール】
 *   (A) 特典会ルーム `event:{eventId}`
 *     - performer: 通話管理権限 (hasCapability 'CALL') を持つこと
 *     - fan      : そのイベントの自分のチケットが IN_MAIN_ROOM であること
 *                  (= スタッフに呼ばれた本人だけが入れる)
 *     - イベントが ENDED / CANCELED なら誰も入れない
 *   (B) 旧来の «URL 共有型» ルーム (roomId = 演者の userId, /admin/call)
 *     - performer: roomId が自分の userId であること (他の管理者による乗っ取り防止)
 *     - fan      : 演者が有効な管理者であること。
 *                  ※ URL を知っている会員なら入れる設計のまま (互換性維持)。
 *                    特典会運営は (A) を使うこと。
 *   それ以外の roomId は拒否する。
 */
import { prisma } from '@idol/db';
import { hasCapability } from '@idol/shared';
import type { ApiSession } from '@/lib/api-auth';

export type CallRoomRole = 'performer' | 'fan';

const EVENT_ROOM_PREFIX = 'event:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** roomId から eventId を取り出す。形式不正なら null */
export function parseEventRoomId(roomId: string): string | null {
  const decoded = decodeURIComponent(roomId);
  if (!decoded.startsWith(EVENT_ROOM_PREFIX)) return null;
  const eventId = decoded.slice(EVENT_ROOM_PREFIX.length);
  return UUID_RE.test(eventId) ? eventId : null;
}

export type CallRoomAccess =
  | { ok: true; eventId: string; role: CallRoomRole; ticketId: string | null }
  | { ok: false; status: 400 | 403 | 404; reason: string };

/**
 * ユーザーが指定の役割でルームに入れるかを判定する。
 * SSE 接続時と、シグナル送信のたびに呼ぶ (送信時にも再判定することで、
 * DONE になった後に古い接続から offer/answer を送り続けることを防ぐ)。
 */
export async function checkCallRoomAccess(
  session: ApiSession,
  roomId: string,
  role: CallRoomRole,
): Promise<CallRoomAccess> {
  const eventId = parseEventRoomId(roomId);
  if (!eventId) {
    return checkLegacyPerformerRoom(session, decodeURIComponent(roomId), role);
  }

  const event = await prisma.callEvent.findUnique({
    where: { id: eventId },
    select: { id: true, status: true },
  });
  if (!event) return { ok: false, status: 404, reason: 'event not found' };
  if (event.status === 'ENDED' || event.status === 'CANCELED') {
    return { ok: false, status: 403, reason: 'event finished' };
  }

  if (role === 'performer') {
    const ok = hasCapability(
      { role: session.user.role, capabilities: session.user.capabilities },
      'CALL',
    );
    return ok
      ? { ok: true, eventId, role, ticketId: null }
      : { ok: false, status: 403, reason: 'performer requires CALL capability' };
  }

  const ticket = await prisma.callTicket.findUnique({
    where: { eventId_userId: { eventId, userId: session.user.id } },
    select: { id: true, status: true },
  });
  if (!ticket || ticket.status !== 'IN_MAIN_ROOM') {
    return { ok: false, status: 403, reason: 'not your turn' };
  }
  return { ok: true, eventId, role, ticketId: ticket.id };
}

/** (B) 旧来の URL 共有型ルーム (roomId = 演者 userId) */
async function checkLegacyPerformerRoom(
  session: ApiSession,
  roomId: string,
  role: CallRoomRole,
): Promise<CallRoomAccess> {
  if (!UUID_RE.test(roomId)) {
    return { ok: false, status: 400, reason: 'invalid room' };
  }
  if (role === 'performer') {
    const ok =
      roomId === session.user.id &&
      hasCapability(
        { role: session.user.role, capabilities: session.user.capabilities },
        'CALL',
      );
    return ok
      ? { ok: true, eventId: '', role, ticketId: null }
      : { ok: false, status: 403, reason: 'not your room' };
  }
  const performer = await prisma.user.findUnique({
    where: { id: roomId },
    select: { role: true, deletedAt: true },
  });
  const valid =
    performer &&
    performer.deletedAt === null &&
    (performer.role === 'ADMIN' || performer.role === 'SUPER_ADMIN');
  return valid
    ? { ok: true, eventId: '', role, ticketId: null }
    : { ok: false, status: 404, reason: 'room not found' };
}

/**
 * ファンのチケットが今も IN_MAIN_ROOM か (SSE 接続中の定期チェック用)。
 * スタッフが「次へ」を押して DONE になったら false を返し、接続を切断させる。
 */
export async function isFanStillInMainRoom(ticketId: string): Promise<boolean> {
  const t = await prisma.callTicket.findUnique({
    where: { id: ticketId },
    select: { status: true },
  });
  return t?.status === 'IN_MAIN_ROOM';
}
