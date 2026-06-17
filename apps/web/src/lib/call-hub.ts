/**
 * 1on1 通話シグナリング用の in-memory hub
 *
 * - SDP / ICE candidate のやり取りを中継するだけ
 * - WebRTC の media stream そのものは P2P でブラウザ間直結 (STUN: Google public)
 * - Map<roomId, Set<Client>> を hot-reload を跨いで持続させるため globalThis に置く
 *
 * ⚠️ 開発用最小構成:
 *   - シングルプロセス前提（PM2 cluster で複数 worker だと room が分散する）
 *   - 本番運用するなら Redis pub/sub 等に置き換える
 */

import type { SignalMessage } from './call-types';

export type CallRole = 'performer' | 'fan';

export type Client = {
  /** クライアントごとに発行するランダム ID */
  clientId: string;
  /** 演者 or ファン */
  role: CallRole;
  /** SSE で push するときに使う */
  send: (event: SignalEvent) => void;
};

/** SSE で配信するイベント */
export type SignalEvent =
  | { type: 'hello'; clientId: string; role: CallRole; peers: { clientId: string; role: CallRole }[] }
  | { type: 'peer-joined'; clientId: string; role: CallRole }
  | { type: 'peer-left'; clientId: string }
  | { type: 'signal'; from: string; payload: SignalMessage }
  | { type: 'ping' };

type Room = {
  roomId: string;
  clients: Map<string, Client>;
};

type Hub = {
  rooms: Map<string, Room>;
};

const GLOBAL_KEY = '__idol_call_hub__';

function getHub(): Hub {
  const g = globalThis as unknown as Record<string, Hub | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { rooms: new Map() };
  }
  return g[GLOBAL_KEY]!;
}

function getOrCreateRoom(roomId: string): Room {
  const hub = getHub();
  let room = hub.rooms.get(roomId);
  if (!room) {
    room = { roomId, clients: new Map() };
    hub.rooms.set(roomId, room);
  }
  return room;
}

function broadcast(room: Room, event: SignalEvent, exceptClientId?: string) {
  for (const c of room.clients.values()) {
    if (c.clientId === exceptClientId) continue;
    try {
      c.send(event);
    } catch {
      // 個別の失敗は無視（次の cleanup で除去される）
    }
  }
}

export function joinRoom(roomId: string, client: Client): () => void {
  const room = getOrCreateRoom(roomId);
  room.clients.set(client.clientId, client);

  // 新参者に既存ピアの一覧を hello で送信
  const peers = [...room.clients.values()]
    .filter((c) => c.clientId !== client.clientId)
    .map((c) => ({ clientId: c.clientId, role: c.role }));
  client.send({ type: 'hello', clientId: client.clientId, role: client.role, peers });

  // 既存ピアに peer-joined を通知
  broadcast(
    room,
    { type: 'peer-joined', clientId: client.clientId, role: client.role },
    client.clientId,
  );

  // 退室時のクリーンアップ関数を返す
  return () => {
    const r = getHub().rooms.get(roomId);
    if (!r) return;
    r.clients.delete(client.clientId);
    broadcast(r, { type: 'peer-left', clientId: client.clientId });
    if (r.clients.size === 0) {
      getHub().rooms.delete(roomId);
    }
  };
}

/**
 * クライアントからの signal (offer/answer/ice) を to が指定されていれば直接、
 * 居なければ部屋全体にブロードキャストする
 */
export function relaySignal(
  roomId: string,
  from: string,
  to: string | undefined,
  payload: SignalMessage,
): { ok: boolean; reason?: string } {
  const room = getHub().rooms.get(roomId);
  if (!room) return { ok: false, reason: 'room not found' };
  if (!room.clients.has(from)) return { ok: false, reason: 'sender not in room' };

  const event: SignalEvent = { type: 'signal', from, payload };

  if (to) {
    const target = room.clients.get(to);
    if (!target) return { ok: false, reason: 'target not in room' };
    target.send(event);
  } else {
    broadcast(room, event, from);
  }
  return { ok: true };
}

export function getRoomStats(roomId: string): { exists: boolean; size: number } {
  const room = getHub().rooms.get(roomId);
  if (!room) return { exists: false, size: 0 };
  return { exists: true, size: room.clients.size };
}
