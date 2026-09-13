import {
  CLOSED_EVENT_STATUSES,
  FINISHED_TICKET_STATUSES,
  callBannerAction,
  canEnterWaitingRoom,
  compareActiveTickets,
  isActiveCallTicket,
  type CallEventStatusLiteral,
  type CallTicketStatusLiteral,
} from './call-ticket-active';

const ALL_TICKET: CallTicketStatusLiteral[] = [
  'WAITING',
  'IN_WAITING_ROOM',
  'IN_MAIN_ROOM',
  'DONE',
  'NO_SHOW',
];
const ALL_EVENT: CallEventStatusLiteral[] = ['SCHEDULED', 'LIVE', 'ENDED', 'CANCELED'];

describe('isActiveCallTicket', () => {
  it('引換直後 (WAITING) は有効 — 待機室へ戻せる', () => {
    // これが無いと «アプリを閉じたら詰む» 問題が解決しない
    expect(
      isActiveCallTicket({ ticketStatus: 'WAITING', eventStatus: 'SCHEDULED' }),
    ).toBe(true);
    expect(isActiveCallTicket({ ticketStatus: 'WAITING', eventStatus: 'LIVE' })).toBe(true);
  });

  it('待機室入室済みは有効', () => {
    expect(
      isActiveCallTicket({ ticketStatus: 'IN_WAITING_ROOM', eventStatus: 'LIVE' }),
    ).toBe(true);
  });

  it('【重要】通話中 (IN_MAIN_ROOM) も有効 — 回線が切れた復帰に使う', () => {
    // ここを除外すると通話中の事故から戻れなくなる
    expect(
      isActiveCallTicket({ ticketStatus: 'IN_MAIN_ROOM', eventStatus: 'LIVE' }),
    ).toBe(true);
  });

  it('通話終了 (DONE) は無効', () => {
    expect(isActiveCallTicket({ ticketStatus: 'DONE', eventStatus: 'LIVE' })).toBe(false);
  });

  it('不応答 (NO_SHOW) は無効', () => {
    expect(isActiveCallTicket({ ticketStatus: 'NO_SHOW', eventStatus: 'LIVE' })).toBe(false);
  });

  it('イベント終了後はどのチケットも無効', () => {
    for (const t of ALL_TICKET) {
      expect(isActiveCallTicket({ ticketStatus: t, eventStatus: 'ENDED' })).toBe(false);
    }
  });

  it('イベント中止後はどのチケットも無効', () => {
    for (const t of ALL_TICKET) {
      expect(isActiveCallTicket({ ticketStatus: t, eventStatus: 'CANCELED' })).toBe(false);
    }
  });

  it('全組み合わせで例外なく boolean を返す', () => {
    for (const t of ALL_TICKET) {
      for (const e of ALL_EVENT) {
        expect(typeof isActiveCallTicket({ ticketStatus: t, eventStatus: e })).toBe(
          'boolean',
        );
      }
    }
  });

  it('有効になるのは「未完了チケット × 開催前/開催中イベント」だけ', () => {
    const active: string[] = [];
    for (const t of ALL_TICKET) {
      for (const e of ALL_EVENT) {
        if (isActiveCallTicket({ ticketStatus: t, eventStatus: e })) active.push(`${t}/${e}`);
      }
    }
    expect(active.sort()).toEqual(
      [
        'WAITING/SCHEDULED',
        'WAITING/LIVE',
        'IN_WAITING_ROOM/SCHEDULED',
        'IN_WAITING_ROOM/LIVE',
        'IN_MAIN_ROOM/SCHEDULED',
        'IN_MAIN_ROOM/LIVE',
      ].sort(),
    );
  });
});

describe('定数の整合性', () => {
  it('終了扱いのチケット状態は DONE / NO_SHOW のみ', () => {
    expect([...FINISHED_TICKET_STATUSES].sort()).toEqual(['DONE', 'NO_SHOW']);
  });
  it('閉じたイベント状態は ENDED / CANCELED のみ', () => {
    expect([...CLOSED_EVENT_STATUSES].sort()).toEqual(['CANCELED', 'ENDED']);
  });
});

describe('callBannerAction', () => {
  it('有効チケットがあれば待機室へ', () => {
    expect(callBannerAction(1)).toBe('enter_waiting');
    expect(callBannerAction(3)).toBe('enter_waiting');
  });
  it('無ければシリアル入力へ', () => {
    expect(callBannerAction(0)).toBe('redeem');
  });
});

describe('canEnterWaitingRoom', () => {
  it('LIVE のときだけ入室できる', () => {
    expect(canEnterWaitingRoom('LIVE')).toBe(true);
  });
  it('開始前 (SCHEDULED) は入室できない', () => {
    // アプリは「開始までお待ちください」を出す
    expect(canEnterWaitingRoom('SCHEDULED')).toBe(false);
  });
  it('終了・中止は入室できない', () => {
    expect(canEnterWaitingRoom('ENDED')).toBe(false);
    expect(canEnterWaitingRoom('CANCELED')).toBe(false);
  });
});

describe('compareActiveTickets', () => {
  const t = (
    ticketStatus: CallTicketStatusLiteral,
    eventStatus: CallEventStatusLiteral,
    startsAtMs: number,
  ) => ({ ticketStatus, eventStatus, startsAtMs });

  it('通話中を最優先にする', () => {
    const list = [
      t('WAITING', 'LIVE', 100),
      t('IN_MAIN_ROOM', 'LIVE', 999),
      t('IN_WAITING_ROOM', 'LIVE', 50),
    ];
    const sorted = [...list].sort(compareActiveTickets);
    expect(sorted[0]!.ticketStatus).toBe('IN_MAIN_ROOM');
  });

  it('同じチケット状態なら開催中 (LIVE) を優先', () => {
    const list = [t('WAITING', 'SCHEDULED', 10), t('WAITING', 'LIVE', 999)];
    const sorted = [...list].sort(compareActiveTickets);
    expect(sorted[0]!.eventStatus).toBe('LIVE');
  });

  it('条件が同じなら開始が早いものを先に', () => {
    const list = [t('WAITING', 'LIVE', 300), t('WAITING', 'LIVE', 100)];
    const sorted = [...list].sort(compareActiveTickets);
    expect(sorted[0]!.startsAtMs).toBe(100);
  });

  it('待機室入室済みは未入室より先', () => {
    const list = [t('WAITING', 'LIVE', 10), t('IN_WAITING_ROOM', 'LIVE', 999)];
    const sorted = [...list].sort(compareActiveTickets);
    expect(sorted[0]!.ticketStatus).toBe('IN_WAITING_ROOM');
  });

  it('空配列・1件でも落ちない', () => {
    expect([].sort(compareActiveTickets)).toEqual([]);
    const one = [t('WAITING', 'LIVE', 1)];
    expect([...one].sort(compareActiveTickets)).toHaveLength(1);
  });
});
