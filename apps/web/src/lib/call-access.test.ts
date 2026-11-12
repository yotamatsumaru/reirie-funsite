jest.mock('@idol/db', () => ({ prisma: {} }));

import {
  decideCallRoomAccess,
  parseCallRoomId,
  type CallRoomFacts,
  type CallViewer,
} from './call-access';

const PERFORMER = '11111111-1111-4111-8111-111111111111';
const FAN = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';

const viewer = (over: Partial<CallViewer> = {}): CallViewer => ({
  userId: FAN,
  role: 'USER',
  plan: 'FREE',
  capabilities: [],
  ...over,
});

describe('parseCallRoomId', () => {
  it('event:<uuid> は特典会ルーム', () => {
    expect(parseCallRoomId(`event:${EVENT}`)).toEqual({ kind: 'event', eventId: EVENT });
  });
  it('uuid だけなら 1on1 (演者の userId)', () => {
    expect(parseCallRoomId(PERFORMER)).toEqual({ kind: 'legacy', performerUserId: PERFORMER });
  });
  it('URL エンコードされた roomId も扱える (event%3A<uuid>)', () => {
    expect(parseCallRoomId(encodeURIComponent(`event:${EVENT}`))).toEqual({
      kind: 'event',
      eventId: EVENT,
    });
  });
  it('パス混入や壊れたエンコードは invalid', () => {
    expect(parseCallRoomId(`event:${EVENT}/../x`).kind).toBe('invalid');
    expect(parseCallRoomId(`room:${EVENT}`).kind).toBe('invalid');
    expect(parseCallRoomId('%E0%A4%A').kind).toBe('invalid');
  });
  it('想定外の形式は invalid', () => {
    expect(parseCallRoomId('event:abc').kind).toBe('invalid');
    expect(parseCallRoomId('hello').kind).toBe('invalid');
    expect(parseCallRoomId('').kind).toBe('invalid');
    expect(parseCallRoomId(`${PERFORMER}x`).kind).toBe('invalid');
  });
});

describe('decideCallRoomAccess: 1on1 (旧方式)', () => {
  const room = parseCallRoomId(PERFORMER);
  const facts: CallRoomFacts = { kind: 'legacy', performerValid: true };

  it('無料会員はファンとして入れない (会員限定)', () => {
    const d = decideCallRoomAccess(viewer(), 'fan', facts, room);
    expect(d).toMatchObject({ ok: false, status: 403 });
  });
  it('スタンダード / プレミアム会員はファンとして入れる', () => {
    expect(decideCallRoomAccess(viewer({ plan: 'STANDARD' }), 'fan', facts, room).ok).toBe(true);
    expect(decideCallRoomAccess(viewer({ plan: 'PREMIUM' }), 'fan', facts, room).ok).toBe(true);
  });
  it('運営は無料プランでもファンとして入れる (動作確認用)', () => {
    const d = decideCallRoomAccess(
      viewer({ userId: 'other-admin', role: 'ADMIN' }),
      'fan',
      facts,
      room,
    );
    expect(d.ok).toBe(true);
  });
  it('演者が無効 (削除済み・ファンロール) なら 404', () => {
    const d = decideCallRoomAccess(
      viewer({ plan: 'PREMIUM' }),
      'fan',
      { kind: 'legacy', performerValid: false },
      room,
    );
    expect(d).toMatchObject({ ok: false, status: 404 });
  });
  it('演者として入れるのはルームの持ち主本人 (CALL 権限あり) だけ', () => {
    const owner = viewer({ userId: PERFORMER, role: 'ADMIN', capabilities: ['CALL'] });
    expect(decideCallRoomAccess(owner, 'performer', facts, room).ok).toBe(true);

    // 別の運営が他人のルームを演者として乗っ取れない
    const otherAdmin = viewer({ userId: 'x', role: 'SUPER_ADMIN' });
    expect(decideCallRoomAccess(otherAdmin, 'performer', facts, room)).toMatchObject({
      ok: false,
      status: 403,
    });
    // 持ち主でも CALL 権限が無ければ不可
    const noCap = viewer({ userId: PERFORMER, role: 'ADMIN', capabilities: [] });
    expect(decideCallRoomAccess(noCap, 'performer', facts, room).ok).toBe(false);
  });
  it('演者本人はファン側では入れない', () => {
    const owner = viewer({ userId: PERFORMER, role: 'ADMIN', plan: 'PREMIUM' });
    expect(decideCallRoomAccess(owner, 'fan', facts, room).ok).toBe(false);
  });
});

describe('decideCallRoomAccess: 特典会', () => {
  const room = parseCallRoomId(`event:${EVENT}`);
  const facts = (status: string | null, eventExists = true): CallRoomFacts => ({
    kind: 'event',
    eventExists,
    viewerTicketStatus: status,
  });

  it('本ルームに呼ばれているチケット本人だけファンとして入れる', () => {
    expect(decideCallRoomAccess(viewer(), 'fan', facts('IN_MAIN_ROOM'), room).ok).toBe(true);
  });
  it.each(['WAITING', 'IN_WAITING_ROOM', 'DONE', 'NO_SHOW'])('%s では入れない (割り込み防止)', (s) => {
    expect(decideCallRoomAccess(viewer({ plan: 'PREMIUM' }), 'fan', facts(s), room)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
  it('チケットが無ければ入れない', () => {
    expect(decideCallRoomAccess(viewer({ plan: 'PREMIUM' }), 'fan', facts(null), room).ok).toBe(false);
  });
  it('イベントが無ければ 404', () => {
    expect(decideCallRoomAccess(viewer(), 'fan', facts('IN_MAIN_ROOM', false), room)).toMatchObject({
      ok: false,
      status: 404,
    });
  });
  it('入室できたファンにはチケット ID を返す (接続中の再確認用)', () => {
    const d = decideCallRoomAccess(
      viewer(),
      'fan',
      { kind: 'event', eventExists: true, viewerTicketStatus: 'IN_MAIN_ROOM', viewerTicketId: 'tkt-1' },
      room,
    );
    expect(d).toEqual({ ok: true, ticketId: 'tkt-1' });
  });
  it.each(['ENDED', 'CANCELED'])('イベントが %s なら演者もファンも入れない', (eventStatus) => {
    const f: CallRoomFacts = {
      kind: 'event',
      eventExists: true,
      eventStatus,
      viewerTicketStatus: 'IN_MAIN_ROOM',
    };
    expect(decideCallRoomAccess(viewer(), 'fan', f, room)).toMatchObject({ ok: false, status: 403 });
    expect(
      decideCallRoomAccess(viewer({ role: 'SUPER_ADMIN' }), 'performer', f, room),
    ).toMatchObject({ ok: false, status: 403 });
  });
  it('開催中 (LIVE 等) のイベントは通常どおり判定する', () => {
    const f: CallRoomFacts = {
      kind: 'event',
      eventExists: true,
      eventStatus: 'LIVE',
      viewerTicketStatus: 'IN_MAIN_ROOM',
    };
    expect(decideCallRoomAccess(viewer(), 'fan', f, room).ok).toBe(true);
  });
  it('演者は CALL 権限が必要', () => {
    expect(
      decideCallRoomAccess(viewer({ role: 'SUPER_ADMIN' }), 'performer', facts(null), room).ok,
    ).toBe(true);
    expect(
      decideCallRoomAccess(viewer({ role: 'ADMIN', capabilities: ['CALL'] }), 'performer', facts(null), room).ok,
    ).toBe(true);
    expect(
      decideCallRoomAccess(viewer({ role: 'ADMIN', capabilities: [] }), 'performer', facts(null), room).ok,
    ).toBe(false);
    expect(decideCallRoomAccess(viewer(), 'performer', facts(null), room).ok).toBe(false);
  });
});

describe('decideCallRoomAccess: 不正なルーム名', () => {
  it('誰も入れない', () => {
    const d = decideCallRoomAccess(
      viewer({ role: 'SUPER_ADMIN' }),
      'performer',
      { kind: 'invalid' },
      { kind: 'invalid' },
    );
    expect(d).toMatchObject({ ok: false, status: 404 });
  });
});
