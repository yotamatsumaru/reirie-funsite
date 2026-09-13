/**
 * GET /api/call/tickets/me — 自分の «まだ有効な» 1on1 チケット一覧
 *
 * 【なぜ必要か / アプリで起きていた問題】
 * シリアルコードを引き換えた後にアプリを閉じると、待機室へ戻る手段が無かった。
 * コードを再入力しても «使用済み» になるため詰んでしまう。
 * 通知タップからは戻れるが、**通知を許可していない人は復帰できない**。
 *
 * これがあれば、ホームの「1ON1 CALL」バナーを
 *   有効なチケットがある → 待機室へ直行
 *   無い                 → シリアル入力へ
 * と自動で振り分けられる。
 *
 * 【返すもの】
 * status が DONE / NO_SHOW 以外、かつイベントが ENDED / CANCELED 以外のもの。
 * 判定は shared の isActiveCallTicket に集約している
 * (画面と API で別々に判定するとズレて «出るはずのバナーが出ない» 事故になる)。
 *
 * 認証: 会員必須 (Bearer / Cookie 両対応)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import {
  callBannerAction,
  canEnterWaitingRoom,
  compareActiveTickets,
  isActiveCallTicket,
  type CallEventStatusLiteral,
  type CallTicketStatusLiteral,
} from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

/**
 * 1 ユーザーが同時に持ちうるチケット数の上限。
 * 実運用では数枚だが、応答が無制限に膨らまないよう保険をかける。
 */
const TICKET_LIMIT = 20;

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const userId = session.user.id;

  /**
   * まず «終わっていない» ものを DB 側で絞る。
   * 全件取ってからアプリ側で捨てるのは無駄なので、
   * DONE / NO_SHOW と ENDED / CANCELED はクエリで除外する。
   */
  const rows = await prisma.callTicket.findMany({
    where: {
      userId,
      status: { notIn: ['DONE', 'NO_SHOW'] },
      event: { status: { notIn: ['ENDED', 'CANCELED'] } },
    },
    select: {
      id: true,
      eventId: true,
      queuePos: true,
      status: true,
      enteredWaitingAt: true,
      enteredMainAt: true,
      event: {
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          status: true,
          perFanSeconds: true,
          noticeText: true,
        },
      },
    },
    take: TICKET_LIMIT,
  });

  /**
   * 自分より前で «まだ呼ばれていない» 人数。
   * 待機室 (SSE) と同じ条件にしないと表示がズレるため、
   * queue/events/route.ts の aheadCount と同一の定義を使う。
   */
  const tickets = await Promise.all(
    rows
      // 念のため共通ロジックでも再確認する (DB 条件と判定の二重化)
      .filter((t) =>
        isActiveCallTicket({
          ticketStatus: t.status as CallTicketStatusLiteral,
          eventStatus: t.event.status as CallEventStatusLiteral,
        }),
      )
      .map(async (t) => {
        const aheadCount = await prisma.callTicket.count({
          where: {
            eventId: t.eventId,
            queuePos: { lt: t.queuePos },
            status: { in: ['WAITING', 'IN_WAITING_ROOM'] },
          },
        });
        return {
          id: t.id,
          eventId: t.eventId,
          queuePos: t.queuePos,
          status: t.status,
          aheadCount,
          enteredWaitingAt: t.enteredWaitingAt?.toISOString() ?? null,
          enteredMainAt: t.enteredMainAt?.toISOString() ?? null,
          /** 待機室に入れる状態か (SCHEDULED の間は false) */
          canEnterWaitingRoom: canEnterWaitingRoom(
            t.event.status as CallEventStatusLiteral,
          ),
          /** 待機室ページの相対パス (アプリはこれを開けばよい) */
          waitingRoomPath: `/call/events/${t.eventId}/waiting`,
          event: {
            id: t.event.id,
            title: t.event.title,
            startsAt: t.event.startsAt.toISOString(),
            endsAt: t.event.endsAt?.toISOString() ?? null,
            status: t.event.status,
            perFanSeconds: t.event.perFanSeconds,
            noticeText: t.event.noticeText,
          },
        };
      }),
  );

  // 「いま行くべきもの」を先頭にする (アプリはバナーに 1 つだけ出す)
  tickets.sort((a, b) =>
    compareActiveTickets(
      {
        ticketStatus: a.status as CallTicketStatusLiteral,
        eventStatus: a.event.status as CallEventStatusLiteral,
        startsAtMs: new Date(a.event.startsAt).getTime(),
      },
      {
        ticketStatus: b.status as CallTicketStatusLiteral,
        eventStatus: b.event.status as CallEventStatusLiteral,
        startsAtMs: new Date(b.event.startsAt).getTime(),
      },
    ),
  );

  return NextResponse.json(
    {
      tickets,
      /**
       * ホームバナーの動作。アプリ側で件数を数えなくてよいように返す。
       *   'enter_waiting' … 待機室へ直行
       *   'redeem'        … シリアル入力へ
       */
      bannerAction: callBannerAction(tickets.length),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
