/**
 * お問い合わせのチャット形式のやり取り (会員 ⇄ 運営)。
 *
 * 1 件のお問い合わせ (ContactMessage) を 1 つの「スレッド」とみなし、
 *   - 最初の問い合わせ本文           … 会員の最初の発言
 *   - ContactReply (sender = ADMIN)  … 運営 (SUPER_ADMIN / STAFF) の返信
 *   - ContactReply (sender = MEMBER) … 会員がマイページから送った追加メッセージ
 * を時系列に並べてチャットとして表示する。
 *
 * 判定ロジック (誰が書けるか・状態をどう変えるか・どう見せるか) は純粋関数にしてテストで固定し、
 * DB アクセスは下半分の関数に分けている。
 *
 * 【見せ方の注意】
 *   会員側には運営の個人名・メールアドレスを出さない (「運営」と表示)。
 *   運営側には誰が返信したかを出す (対応の引き継ぎに必要)。
 */
import { prisma } from '@idol/db';
import type { ContactSenderLiteral, ContactStatusLiteral } from '@idol/shared';
import { errors } from '@/lib/errors';

/** 同じスレッドへの会員メッセージの最短間隔 (連打・二重送信防止) */
export const MEMBER_MESSAGE_COOLDOWN_MS = 3_000;
/** 同じスレッドへの会員メッセージの 1 時間あたりの上限 */
export const MEMBER_MESSAGE_HOURLY_LIMIT = 30;
/** 1 スレッドで読み込む最大メッセージ数 (異常に長いスレッドで画面が重くならないように) */
export const THREAD_MESSAGE_LIMIT = 500;

export type ChatViewer = 'MEMBER' | 'ADMIN';

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export type ThreadReplyRow = {
  id: string;
  sender: ContactSenderLiteral;
  body: string;
  createdAt: Date;
  readAt: Date | null;
  adminReadAt: Date | null;
  emailSent: boolean;
  emailError: string | null;
  repliedBy: { displayName: string | null; email: string } | null;
};

export type ThreadRow = {
  id: string;
  ticketNumber: string | null;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: ContactStatusLiteral;
  userId: string | null;
  createdAt: Date;
  lastMessageAt: Date;
  replies: ThreadReplyRow[];
};

/** 画面・API に返す 1 メッセージ */
export type ChatMessage = {
  id: string;
  sender: ContactSenderLiteral;
  body: string;
  /** ISO 文字列 */
  createdAt: string;
  /** 表示名 (会員側から見た運営は常に「運営」) */
  authorLabel: string;
  /** 相手が読んだか (自分の発言にだけ「既読」を出すのに使う) */
  readByOther: boolean;
  /** 最初の問い合わせ本文か */
  isInitial: boolean;
  /** 運営の返信をメールでも届けられたか (運営側の表示のみ。会員側では null) */
  emailSent: boolean | null;
  emailError: string | null;
};

// ---------------------------------------------------------------------------
// 純粋関数 (テスト対象)
// ---------------------------------------------------------------------------

/** スレッドを時系列のチャットメッセージに変換する */
export function toChatMessages(thread: ThreadRow, viewer: ChatViewer): ChatMessage[] {
  const replies = [...thread.replies].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const hasAdminReply = replies.some((r) => r.sender === 'ADMIN');

  const initial: ChatMessage = {
    id: `initial-${thread.id}`,
    sender: 'MEMBER',
    body: thread.message,
    createdAt: thread.createdAt.toISOString(),
    authorLabel: viewer === 'MEMBER' ? 'あなた' : thread.name,
    // 運営が状態を動かした / 返信した = 読んだとみなす
    readByOther: thread.status !== 'NEW' || hasAdminReply,
    isInitial: true,
    emailSent: null,
    emailError: null,
  };

  const rest = replies.map<ChatMessage>((r) => {
    if (r.sender === 'ADMIN') {
      return {
        id: r.id,
        sender: 'ADMIN',
        body: r.body,
        createdAt: r.createdAt.toISOString(),
        authorLabel:
          viewer === 'MEMBER'
            ? '運営'
            : r.repliedBy?.displayName?.trim() || r.repliedBy?.email || '運営',
        readByOther: r.readAt !== null,
        isInitial: false,
        emailSent: viewer === 'ADMIN' ? r.emailSent : null,
        emailError: viewer === 'ADMIN' ? r.emailError : null,
      };
    }
    return {
      id: r.id,
      sender: 'MEMBER',
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      authorLabel: viewer === 'MEMBER' ? 'あなた' : thread.name,
      readByOther: r.adminReadAt !== null,
      isInitial: false,
      emailSent: null,
      emailError: null,
    };
  });

  return [initial, ...rest];
}

export type MemberPostDecision = { ok: true } | { ok: false; status: 403 | 404; message: string };

/**
 * 会員がこのスレッドに書き込めるか。
 *  - 自分のお問い合わせ以外は存在しない扱い (404。他人の問い合わせの有無を漏らさない)
 *  - 運営が「クローズ」にしたものには書けない (スパム等で打ち切ったスレッド)
 *  - 「対応済み」には書ける (追加の質問で自動的に対応中へ戻る)
 */
export function memberPostDecision(
  thread: { userId: string | null; status: ContactStatusLiteral } | null,
  viewerUserId: string,
): MemberPostDecision {
  if (!thread || !thread.userId || thread.userId !== viewerUserId) {
    return { ok: false, status: 404, message: 'お問い合わせが見つかりません' };
  }
  if (thread.status === 'CLOSED') {
    return {
      ok: false,
      status: 403,
      message:
        'このお問い合わせは終了しています。引き続きご質問がある場合は、新しくお問い合わせください。',
    };
  }
  return { ok: true };
}

/** 会員が追加メッセージを送ったあとの対応状況 (対応済みなら対応中に戻して運営に気づかせる) */
export function statusAfterMemberMessage(status: ContactStatusLiteral): ContactStatusLiteral {
  return status === 'RESOLVED' ? 'IN_PROGRESS' : status;
}

/** 運営が返信したあとの対応状況 */
export function statusAfterAdminReply(
  status: ContactStatusLiteral,
  markResolved: boolean,
): ContactStatusLiteral {
  if (markResolved) return 'RESOLVED';
  return status === 'NEW' ? 'IN_PROGRESS' : status;
}

/**
 * 会員の追加メッセージで運営にメール通知するか。
 * 未読の会員メッセージがすでにあるなら、運営はまだ画面を見ていないので重ねて送らない
 * (チャットで続けて何通も送られたときに、通知メールが同じ数だけ届くのを防ぐ)。
 */
export function shouldNotifyAdminsOfMemberMessage(unreadMemberMessagesBefore: number): boolean {
  return unreadMemberMessagesBefore === 0;
}

/** 会員メッセージの送信間隔・回数の制限 */
export function memberRateLimitError(
  recentCreatedAt: Date[],
  now: number = Date.now(),
): string | null {
  const hourAgo = now - 60 * 60 * 1000;
  const inHour = recentCreatedAt.filter((d) => d.getTime() >= hourAgo);
  if (inHour.length >= MEMBER_MESSAGE_HOURLY_LIMIT) {
    return '短時間に送信できる回数の上限に達しました。しばらく時間をおいてから再度お試しください。';
  }
  const latest = Math.max(0, ...inHour.map((d) => d.getTime()));
  if (latest && now - latest < MEMBER_MESSAGE_COOLDOWN_MS) {
    return '送信間隔が短すぎます。少し時間をおいてから再度お試しください。';
  }
  return null;
}

/** 一覧用に本文を 1 行・80 文字程度に縮める */
export function previewText(body: string, max = 80): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

// ---------------------------------------------------------------------------
// DB アクセス
// ---------------------------------------------------------------------------

const THREAD_SELECT = {
  id: true,
  ticketNumber: true,
  name: true,
  email: true,
  subject: true,
  message: true,
  status: true,
  userId: true,
  createdAt: true,
  lastMessageAt: true,
  replies: {
    orderBy: { createdAt: 'asc' as const },
    take: THREAD_MESSAGE_LIMIT,
    select: {
      id: true,
      sender: true,
      body: true,
      createdAt: true,
      readAt: true,
      adminReadAt: true,
      emailSent: true,
      emailError: true,
      repliedBy: { select: { displayName: true, email: true } },
    },
  },
} as const;

/** スレッドを 1 件読み込む (権限確認は呼び出し側で行う) */
export async function loadThread(contactId: string): Promise<ThreadRow | null> {
  const row = await prisma.contactMessage.findUnique({
    where: { id: contactId },
    select: THREAD_SELECT,
  });
  return (row as unknown as ThreadRow | null) ?? null;
}

/** 会員本人のスレッドを読み込む。他人のものは null (404 扱い) */
export async function loadMemberThread(
  userId: string,
  contactId: string,
): Promise<ThreadRow | null> {
  const thread = await loadThread(contactId);
  if (!thread || thread.userId !== userId) return null;
  return thread;
}

export type MemberThreadSummary = {
  id: string;
  ticketNumber: string | null;
  subject: string;
  status: ContactStatusLiteral;
  createdAt: Date;
  lastMessageAt: Date;
  /** 最後のメッセージの抜粋 */
  lastPreview: string;
  lastSender: ContactSenderLiteral;
  /** 未読の運営メッセージ数 */
  unreadCount: number;
};

/** 会員のお問い合わせ一覧 (最近やり取りがあった順) */
export async function listMemberThreads(
  userId: string,
  take = 100,
): Promise<MemberThreadSummary[]> {
  const rows = await prisma.contactMessage.findMany({
    where: { userId },
    orderBy: { lastMessageAt: 'desc' },
    take,
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      status: true,
      message: true,
      createdAt: true,
      lastMessageAt: true,
      replies: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { sender: true, body: true },
      },
      _count: { select: { replies: { where: { sender: 'ADMIN', readAt: null } } } },
    },
  });
  return rows.map((r) => {
    const last = r.replies[0];
    return {
      id: r.id,
      ticketNumber: r.ticketNumber,
      subject: r.subject,
      status: r.status as ContactStatusLiteral,
      createdAt: r.createdAt,
      lastMessageAt: r.lastMessageAt,
      lastPreview: previewText(last?.body ?? r.message),
      lastSender: (last?.sender ?? 'MEMBER') as ContactSenderLiteral,
      unreadCount: r._count.replies,
    };
  });
}

/** 会員が読んでいない運営メッセージの件数 (マイページのバッジ用) */
export async function countUnreadForMember(userId: string): Promise<number> {
  return prisma.contactReply.count({
    where: { sender: 'ADMIN', readAt: null, contactMessage: { userId } },
  });
}

/** 運営が読んでいない会員メッセージがあるスレッド数 (管理画面のバッジ用) */
export async function countThreadsWithUnreadMemberMessages(): Promise<number> {
  return prisma.contactMessage.count({
    where: { replies: { some: { sender: 'MEMBER', adminReadAt: null } } },
  });
}

/** 会員がスレッドを開いた: 運営メッセージを既読にする (本人のスレッドのみ) */
export async function markThreadReadByMember(userId: string, contactId: string): Promise<number> {
  const r = await prisma.contactReply.updateMany({
    where: {
      contactMessageId: contactId,
      sender: 'ADMIN',
      readAt: null,
      contactMessage: { userId },
    },
    data: { readAt: new Date() },
  });
  return r.count;
}

/** 運営がスレッドを開いた: 会員メッセージを既読にする */
export async function markThreadReadByAdmin(contactId: string): Promise<number> {
  const r = await prisma.contactReply.updateMany({
    where: { contactMessageId: contactId, sender: 'MEMBER', adminReadAt: null },
    data: { adminReadAt: new Date() },
  });
  return r.count;
}

export type PostMemberMessageResult = {
  message: ChatMessage;
  status: ContactStatusLiteral;
  /** 運営にメール通知すべきか (通知の送信は呼び出し側) */
  notifyAdmins: boolean;
  thread: {
    id: string;
    ticketNumber: string | null;
    subject: string;
    name: string;
    email: string;
    memberNumber: string | null;
  };
};

/**
 * 会員がスレッドに追加メッセージを送る。
 * 権限・終了済み・送信間隔を確認し、メッセージ保存と対応状況の更新を 1 トランザクションで行う。
 */
export async function postMemberMessage(params: {
  userId: string;
  contactId: string;
  body: string;
  now?: Date;
}): Promise<PostMemberMessageResult> {
  const now = params.now ?? new Date();
  const thread = await prisma.contactMessage.findUnique({
    where: { id: params.contactId },
    select: {
      id: true,
      userId: true,
      status: true,
      ticketNumber: true,
      subject: true,
      name: true,
      email: true,
      user: { select: { memberNumber: true } },
    },
  });

  const decision = memberPostDecision(
    thread ? { userId: thread.userId, status: thread.status as ContactStatusLiteral } : null,
    params.userId,
  );
  if (!decision.ok) {
    throw decision.status === 404
      ? errors.notFound(decision.message)
      : errors.forbidden(decision.message);
  }
  const t = thread!;

  const recent = await prisma.contactReply.findMany({
    where: {
      contactMessageId: t.id,
      sender: 'MEMBER',
      createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const limited = memberRateLimitError(
    recent.map((r) => r.createdAt),
    now.getTime(),
  );
  if (limited) throw errors.rateLimited(limited);

  const unreadBefore = await prisma.contactReply.count({
    where: { contactMessageId: t.id, sender: 'MEMBER', adminReadAt: null },
  });

  const nextStatus = statusAfterMemberMessage(t.status as ContactStatusLiteral);
  const [created] = await prisma.$transaction([
    prisma.contactReply.create({
      data: {
        contactMessageId: t.id,
        sender: 'MEMBER',
        body: params.body,
        repliedById: params.userId,
        createdAt: now,
      },
      select: { id: true, createdAt: true },
    }),
    prisma.contactMessage.update({
      where: { id: t.id },
      data: { lastMessageAt: now, status: nextStatus },
    }),
    // 会員が書き込んだ = 画面を開いている。届いている運営メッセージは既読にする
    prisma.contactReply.updateMany({
      where: { contactMessageId: t.id, sender: 'ADMIN', readAt: null },
      data: { readAt: now },
    }),
  ]);

  return {
    message: {
      id: created.id,
      sender: 'MEMBER',
      body: params.body,
      createdAt: created.createdAt.toISOString(),
      authorLabel: 'あなた',
      readByOther: false,
      isInitial: false,
      emailSent: null,
      emailError: null,
    },
    status: nextStatus,
    notifyAdmins: shouldNotifyAdminsOfMemberMessage(unreadBefore),
    thread: {
      id: t.id,
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      name: t.name,
      email: t.email,
      memberNumber: t.user?.memberNumber ?? null,
    },
  };
}
