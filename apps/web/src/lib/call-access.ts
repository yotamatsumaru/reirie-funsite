/**
 * 1on1 / 特典会の通話ルーム (`/api/call/[roomId]/*`) に「誰が・どの役で」入れるかの判定。
 *
 * 【以前の問題】
 * 通話画面 (ページ) 側ではチケットや演者を確認していたが、裏側のシグナリング API は
 * 「ログインしていれば誰でも、どのルームにもファンとして入れる」状態だった。
 * ルーム名はイベント ID や演者の userId から機械的に決まるため、
 *   - 特典会: 順番を無視して通話に割り込む / 他人の通話の接続情報を受け取る
 *   - 1on1  : 無料会員でも演者に通話をかけられる
 * ことができた。API 側でもページと同じ条件を必ず確認する。
 *
 * ルーム名の種類 (呼び出し元: components/call/CallRoom.tsx)
 *   - `event:<CallEvent.id>` … 特典会の本ルーム
 *       演者  : CALL 権限を持つ運営 (/admin/call/events/[id]/main と同じ条件)
 *       ファン: そのイベントのチケットを持ち、いま本ルームに呼ばれている (IN_MAIN_ROOM) 本人
 *       終了 (ENDED) / 中止 (CANCELED) したイベントには誰も入れない
 *       ファンは接続中も定期的に再確認し、DONE / NO_SHOW になったら切断する
 *       (isFanStillInMainRoom を events API から呼ぶ)
 *   - `<演者の userId>`  … 昔からある 1on1 (/call/<演者の userId>)
 *       演者  : そのルームの持ち主本人 (CALL 権限あり)
 *       ファン: 会員 (スタンダード以上の有料プラン) または運営
 *
 * 判定ロジックは純粋関数 (decideCallRoomAccess) にしてテストで固定し、
 * DB からの材料集めだけを loadCallRoomContext で行う。
 */
import { prisma } from '@idol/db';
import {
  canAccess,
  hasCapability,
  isAdmin,
  type AdminCapabilityLiteral,
  type PlanTypeLiteral,
  type UserRoleLiteral,
} from '@idol/shared';
import type { CallRole } from '@/lib/call-hub';

const EVENT_ROOM_PREFIX = 'event:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 1on1 (旧方式) のファンに必要な公開範囲。「会員限定」= スタンダード以上 */
export const LEGACY_CALL_FAN_ACCESS_LEVEL = 'MEMBERS' as const;

export type CallRoomKind =
  | { kind: 'event'; eventId: string }
  | { kind: 'legacy'; performerUserId: string }
  | { kind: 'invalid' };

/** ルーム名を解釈する。想定外の形式は invalid (= 誰も入れない) */
export function parseCallRoomId(rawRoomId: string): CallRoomKind {
  // URL エンコードされたまま渡ってきても扱えるようにする (`event%3A<uuid>`)
  let roomId: string;
  try {
    roomId = decodeURIComponent(rawRoomId);
  } catch {
    return { kind: 'invalid' };
  }
  if (roomId.startsWith(EVENT_ROOM_PREFIX)) {
    const eventId = roomId.slice(EVENT_ROOM_PREFIX.length);
    return UUID_RE.test(eventId) ? { kind: 'event', eventId } : { kind: 'invalid' };
  }
  return UUID_RE.test(roomId) ? { kind: 'legacy', performerUserId: roomId } : { kind: 'invalid' };
}

export type CallViewer = {
  userId: string;
  role: UserRoleLiteral;
  plan: PlanTypeLiteral;
  capabilities: readonly AdminCapabilityLiteral[];
};

/** 判定に必要な DB 上の事実 (loadCallRoomContext が集める) */
export type CallRoomFacts =
  | {
      kind: 'event';
      /** イベントが存在するか */
      eventExists: boolean;
      /** イベントの状態 (存在しなければ null)。ENDED / CANCELED なら誰も入れない */
      eventStatus?: string | null;
      /** 閲覧者のチケットの状態 (チケットが無ければ null) */
      viewerTicketStatus: string | null;
      /** 閲覧者のチケット ID (接続中の再確認に使う) */
      viewerTicketId?: string | null;
    }
  | {
      kind: 'legacy';
      /** ルームの持ち主 (演者) が有効か: 存在・未削除・運営ロール */
      performerValid: boolean;
    }
  | { kind: 'invalid' };

export type CallRoomDecision =
  | {
      ok: true;
      /**
       * 特典会ルームにファンとして入るときのチケット ID。
       * 接続中に «まだ自分の番か» を再確認するのに使う。それ以外は null。
       */
      ticketId: string | null;
    }
  | { ok: false; status: 401 | 403 | 404; message: string };

const ALLOW: CallRoomDecision = { ok: true, ticketId: null };

/**
 * この閲覧者が、このルームに、この役で入ってよいか。
 *
 * 404 と 403 の使い分け: ルームそのものが無い / 形式が不正なら 404、
 * ルームはあるが条件を満たさないなら 403 (画面側で理由を出せるようにする)。
 */
export function decideCallRoomAccess(
  viewer: CallViewer,
  role: CallRole,
  facts: CallRoomFacts,
  room: CallRoomKind,
): CallRoomDecision {
  const canOperateCalls = hasCapability(
    { role: viewer.role, capabilities: viewer.capabilities },
    'CALL',
  );

  if (facts.kind === 'invalid' || room.kind === 'invalid') {
    return { ok: false, status: 404, message: 'ルームが見つかりません' };
  }

  if (facts.kind === 'event' && room.kind === 'event') {
    if (!facts.eventExists) {
      return { ok: false, status: 404, message: 'イベントが見つかりません' };
    }
    // 終了・中止したイベントの通話ルームには、演者も含め誰も入れない
    if (facts.eventStatus === 'ENDED' || facts.eventStatus === 'CANCELED') {
      return { ok: false, status: 403, message: 'このイベントは終了しました' };
    }
    if (role === 'performer') {
      return canOperateCalls
        ? ALLOW
        : { ok: false, status: 403, message: '演者として入室する権限がありません' };
    }
    // ファン: いま本ルームに呼ばれているチケットの持ち主だけ
    if (facts.viewerTicketStatus === 'IN_MAIN_ROOM') {
      return { ok: true, ticketId: facts.viewerTicketId ?? null };
    }
    return {
      ok: false,
      status: 403,
      message: facts.viewerTicketStatus
        ? 'まだ順番ではありません。待機室でお待ちください'
        : 'このイベントのチケットをお持ちではありません',
    };
  }

  if (facts.kind === 'legacy' && room.kind === 'legacy') {
    if (!facts.performerValid) {
      return { ok: false, status: 404, message: 'このコールルームは無効です' };
    }
    if (role === 'performer') {
      // 自分のルームにだけ演者として入れる (他の演者のルームを乗っ取れない)
      return viewer.userId === room.performerUserId && canOperateCalls
        ? ALLOW
        : { ok: false, status: 403, message: '演者として入室する権限がありません' };
    }
    // ファン: 会員 (スタンダード以上) か運営。演者本人がファン側で入ることはない
    if (viewer.userId === room.performerUserId) {
      return { ok: false, status: 403, message: '自分のルームにはファンとして入れません' };
    }
    if (canAccess(viewer.plan, LEGACY_CALL_FAN_ACCESS_LEVEL) || isAdmin(viewer.role)) {
      return ALLOW;
    }
    return { ok: false, status: 403, message: '1on1 コールは会員限定です' };
  }

  return { ok: false, status: 404, message: 'ルームが見つかりません' };
}

/** DB から判定材料を集める */
export async function loadCallRoomContext(
  room: CallRoomKind,
  viewerUserId: string,
): Promise<CallRoomFacts> {
  if (room.kind === 'event') {
    const [event, ticket] = await Promise.all([
      prisma.callEvent.findUnique({
        where: { id: room.eventId },
        select: { id: true, status: true },
      }),
      prisma.callTicket.findUnique({
        where: { eventId_userId: { eventId: room.eventId, userId: viewerUserId } },
        select: { id: true, status: true },
      }),
    ]);
    return {
      kind: 'event',
      eventExists: !!event,
      eventStatus: event?.status ?? null,
      viewerTicketStatus: ticket?.status ?? null,
      viewerTicketId: ticket?.id ?? null,
    };
  }
  if (room.kind === 'legacy') {
    const performer = await prisma.user.findUnique({
      where: { id: room.performerUserId },
      select: { role: true, deletedAt: true },
    });
    const performerValid =
      !!performer &&
      performer.deletedAt === null &&
      (performer.role === 'ADMIN' || performer.role === 'SUPER_ADMIN');
    return { kind: 'legacy', performerValid };
  }
  return { kind: 'invalid' };
}

/** API 用: ルーム名・閲覧者・役から最終判定までを行う */
export async function checkCallRoomAccess(
  roomId: string,
  viewer: CallViewer,
  role: CallRole,
): Promise<CallRoomDecision> {
  const room = parseCallRoomId(roomId);
  if (room.kind === 'invalid') {
    return { ok: false, status: 404, message: 'ルームが見つかりません' };
  }
  const facts = await loadCallRoomContext(room, viewer.userId);
  return decideCallRoomAccess(viewer, role, facts, room);
}

/**
 * ファンのチケットが今も IN_MAIN_ROOM か (SSE 接続中の定期チェック用)。
 * スタッフが「次へ」を押して DONE / NO_SHOW になったら false を返し、接続を切断させる。
 * これをしないと、通話を終えた人が接続を張ったまま次の人の通話に居座れる。
 */
export async function isFanStillInMainRoom(ticketId: string): Promise<boolean> {
  const t = await prisma.callTicket.findUnique({
    where: { id: ticketId },
    select: { status: true },
  });
  return t?.status === 'IN_MAIN_ROOM';
}
