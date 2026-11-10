import {
  MAX_CLIENTS_PER_ROOM,
  MAX_CLIENTS_PER_USER_IN_ROOM,
  getRoomStats,
  relaySignal,
  tryJoinRoom,
  type Client,
  type SignalEvent,
} from './call-hub';

let seq = 0;
function client(userId: string, role: Client['role'] = 'fan') {
  const received: SignalEvent[] = [];
  const c: Client = { clientId: `c${++seq}`, userId, role, send: (e) => received.push(e) };
  return { c, received };
}

const offer = { kind: 'offer' as const, sdp: 'v=0' };

describe('call-hub', () => {
  it('from の clientId が送信者本人の接続でなければ中継しない (なりすまし防止)', () => {
    const room = `room-${++seq}`;
    const perf = client('performer', 'performer');
    const fan = client('fan');
    const j1 = tryJoinRoom(room, perf.c);
    const j2 = tryJoinRoom(room, fan.c);
    expect(j1.ok && j2.ok).toBe(true);

    // 第三者が演者の clientId を名乗る
    expect(relaySignal(room, perf.c.clientId, fan.c.clientId, offer, 'attacker').ok).toBe(false);
    expect(fan.received.some((e) => e.type === 'signal')).toBe(false);

    // 本人なら届く
    expect(relaySignal(room, perf.c.clientId, fan.c.clientId, offer, 'performer').ok).toBe(true);
    expect(fan.received.some((e) => e.type === 'signal')).toBe(true);

    if (j1.ok) j1.leave();
    if (j2.ok) j2.leave();
    expect(getRoomStats(room).exists).toBe(false);
  });

  it('同じユーザーの接続数に上限がある', () => {
    const room = `room-${++seq}`;
    const leaves: (() => void)[] = [];
    for (let i = 0; i < MAX_CLIENTS_PER_USER_IN_ROOM; i++) {
      const r = tryJoinRoom(room, client('same').c);
      expect(r.ok).toBe(true);
      if (r.ok) leaves.push(r.leave);
    }
    expect(tryJoinRoom(room, client('same').c)).toEqual({ ok: false, reason: 'too many connections' });
    leaves.forEach((l) => l());
  });

  it('ルーム全体の接続数に上限がある', () => {
    const room = `room-${++seq}`;
    const leaves: (() => void)[] = [];
    for (let i = 0; i < MAX_CLIENTS_PER_ROOM; i++) {
      const r = tryJoinRoom(room, client(`u${i}`).c);
      expect(r.ok).toBe(true);
      if (r.ok) leaves.push(r.leave);
    }
    expect(tryJoinRoom(room, client('late').c)).toEqual({ ok: false, reason: 'room full' });
    leaves.forEach((l) => l());
  });
});
