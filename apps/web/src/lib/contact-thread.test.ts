jest.mock('@idol/db', () => ({ prisma: {} }));

import {
  MEMBER_MESSAGE_COOLDOWN_MS,
  MEMBER_MESSAGE_HOURLY_LIMIT,
  memberPostDecision,
  memberRateLimitError,
  previewText,
  shouldNotifyAdminsOfMemberMessage,
  statusAfterAdminReply,
  statusAfterMemberMessage,
  toChatMessages,
  type ThreadRow,
} from './contact-thread';

const base = (over: Partial<ThreadRow> = {}): ThreadRow => ({
  id: 't1',
  ticketNumber: 'CT-20261127-ABCDE',
  name: '山田花子',
  email: 'hanako@example.com',
  subject: 'ログインできません',
  message: '最初の問い合わせ',
  status: 'NEW',
  userId: 'u1',
  createdAt: new Date('2026-11-27T00:00:00Z'),
  lastMessageAt: new Date('2026-11-27T00:00:00Z'),
  replies: [],
  ...over,
});

const reply = (o: Partial<ThreadRow['replies'][number]>): ThreadRow['replies'][number] => ({
  id: 'r',
  sender: 'ADMIN',
  body: 'b',
  createdAt: new Date('2026-11-27T01:00:00Z'),
  readAt: null,
  adminReadAt: null,
  emailSent: true,
  emailError: null,
  repliedBy: { displayName: 'スタッフA', email: 'staff@example.com' },
  ...o,
});

describe('toChatMessages', () => {
  const thread = base({
    status: 'IN_PROGRESS',
    replies: [
      reply({ id: 'm2', sender: 'MEMBER', body: '追加です', createdAt: new Date('2026-11-27T02:00:00Z'), adminReadAt: new Date() }),
      reply({ id: 'a1', sender: 'ADMIN', body: '回答です', createdAt: new Date('2026-11-27T01:00:00Z'), readAt: null }),
    ],
  });

  it('最初の問い合わせを先頭に、時系列で並べる', () => {
    const msgs = toChatMessages(thread, 'MEMBER');
    expect(msgs.map((m) => m.id)).toEqual(['initial-t1', 'a1', 'm2']);
    expect(msgs[0]).toMatchObject({ isInitial: true, sender: 'MEMBER', body: '最初の問い合わせ' });
  });

  it('会員側には運営の個人名・メール送信結果を出さない', () => {
    const msgs = toChatMessages(thread, 'MEMBER');
    const admin = msgs.find((m) => m.id === 'a1')!;
    expect(admin.authorLabel).toBe('運営');
    expect(admin.emailSent).toBeNull();
    expect(JSON.stringify(msgs)).not.toContain('staff@example.com');
    expect(msgs[0].authorLabel).toBe('あなた');
  });

  it('運営側には返信者名・メール送信結果・会員名を出す', () => {
    const msgs = toChatMessages(thread, 'ADMIN');
    expect(msgs.find((m) => m.id === 'a1')).toMatchObject({ authorLabel: 'スタッフA', emailSent: true });
    expect(msgs.find((m) => m.id === 'm2')).toMatchObject({ authorLabel: '山田花子', readByOther: true });
  });

  it('既読: 運営の返信は会員の readAt、会員メッセージは adminReadAt で判定', () => {
    const msgs = toChatMessages(thread, 'MEMBER');
    expect(msgs.find((m) => m.id === 'a1')!.readByOther).toBe(false);
    expect(msgs.find((m) => m.id === 'm2')!.readByOther).toBe(true);
  });

  it('最初の問い合わせは、運営が状態を変えるか返信したら既読扱い', () => {
    expect(toChatMessages(base(), 'MEMBER')[0].readByOther).toBe(false);
    expect(toChatMessages(base({ status: 'IN_PROGRESS' }), 'MEMBER')[0].readByOther).toBe(true);
    expect(toChatMessages(base({ replies: [reply({})] }), 'MEMBER')[0].readByOther).toBe(true);
  });
});

describe('memberPostDecision', () => {
  it('本人のスレッドなら書ける (対応済みでも可)', () => {
    expect(memberPostDecision({ userId: 'u1', status: 'NEW' }, 'u1').ok).toBe(true);
    expect(memberPostDecision({ userId: 'u1', status: 'RESOLVED' }, 'u1').ok).toBe(true);
  });
  it('他人・ゲスト・存在しないスレッドは 404 (有無を漏らさない)', () => {
    expect(memberPostDecision({ userId: 'u2', status: 'NEW' }, 'u1')).toMatchObject({ ok: false, status: 404 });
    expect(memberPostDecision({ userId: null, status: 'NEW' }, 'u1')).toMatchObject({ ok: false, status: 404 });
    expect(memberPostDecision(null, 'u1')).toMatchObject({ ok: false, status: 404 });
  });
  it('クローズ済みには書けない', () => {
    expect(memberPostDecision({ userId: 'u1', status: 'CLOSED' }, 'u1')).toMatchObject({ ok: false, status: 403 });
  });
});

describe('対応状況の自動更新', () => {
  it('会員が追加メッセージを送ると、対応済みは対応中に戻る', () => {
    expect(statusAfterMemberMessage('RESOLVED')).toBe('IN_PROGRESS');
    expect(statusAfterMemberMessage('NEW')).toBe('NEW');
    expect(statusAfterMemberMessage('IN_PROGRESS')).toBe('IN_PROGRESS');
  });
  it('運営の返信: 対応済みにする指定があれば対応済み、なければ新規→対応中', () => {
    expect(statusAfterAdminReply('NEW', true)).toBe('RESOLVED');
    expect(statusAfterAdminReply('NEW', false)).toBe('IN_PROGRESS');
    expect(statusAfterAdminReply('RESOLVED', false)).toBe('RESOLVED');
    expect(statusAfterAdminReply('CLOSED', false)).toBe('CLOSED');
  });
});

describe('運営へのメール通知', () => {
  it('未読の会員メッセージがすでにあるときは重ねて通知しない', () => {
    expect(shouldNotifyAdminsOfMemberMessage(0)).toBe(true);
    expect(shouldNotifyAdminsOfMemberMessage(1)).toBe(false);
  });
});

describe('memberRateLimitError', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  it('直前の送信から間隔が短いと拒否', () => {
    expect(memberRateLimitError([new Date(now - 1000)], now)).toMatch(/間隔/);
    expect(memberRateLimitError([new Date(now - MEMBER_MESSAGE_COOLDOWN_MS - 1)], now)).toBeNull();
  });
  it('1 時間の上限', () => {
    const many = Array.from({ length: MEMBER_MESSAGE_HOURLY_LIMIT }, (_, i) => new Date(now - 60_000 * (i + 1)));
    expect(memberRateLimitError(many, now)).toMatch(/上限/);
    expect(memberRateLimitError(many.slice(1), now)).toBeNull();
  });
});

describe('previewText', () => {
  it('改行をまとめて短くする', () => {
    expect(previewText('a\n\nb   c')).toBe('a b c');
    expect(previewText('x'.repeat(100), 10)).toBe(`${'x'.repeat(10)}…`);
  });
});
