/**
 * GET /api/me/contact-replies — 自分が受け取った運営からの返信一覧
 *
 * マイページの「運営からのお知らせ」セクションと同じデータ。
 * 既読化 API (POST /api/me/contact-reply/read) は以前からあるのに
 * 一覧取得が無く、アプリからは「何が届いているか」が分からなかった。
 *
 * ## 絞り込みは lib/contact-reply.ts に任せる
 *
 * `listMyContactReplies(userId)` が
 * `contactMessage: { userId }` で絞っている。
 * ここで自前に prisma を叩くと、その条件を書き漏らしたときに
 * **他人宛の返信が読めてしまう**。返信本文には個人的な問い合わせへの
 * 回答が入るため、漏洩の影響が大きい。既存ヘルパーをそのまま使う。
 *
 * ## 未読件数も返す
 *
 * アプリのバッジ表示に使う。一覧の readAt から数えることもできるが、
 * `listMyContactReplies` は take: 50 で打ち切るため、
 * 51 件目以降に未読があるとバッジの数が実際と合わなくなる。
 * 件数は専用のクエリ (countUnreadContactReplies) で数える。
 *
 * response:
 *   { replies: [{ id, subject, body, createdAt, readAt }], unreadCount }
 */
import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { countUnreadContactReplies, listMyContactReplies } from '@/lib/contact-reply';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);

  const [replies, unreadCount] = await Promise.all([
    listMyContactReplies(session.user.id),
    countUnreadContactReplies(session.user.id),
  ]);

  return NextResponse.json({
    replies: replies.map((r) => ({
      id: r.id,
      subject: r.subject,
      body: r.body,
      createdAt: r.createdAt,
      readAt: r.readAt,
    })),
    unreadCount,
  });
});
