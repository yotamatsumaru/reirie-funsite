/**
 * /call/events/[id]/waiting
 *
 * ファン待機室。
 *
 * - 注意事項テキスト表示
 * - 自分のチケット位置・待機状況を SSE で受信し表示
 * - status=IN_MAIN_ROOM になったら「本ルームへ移動」ボタンを表示
 *   (iOS Safari の getUserMedia 制約のため自動遷移ではなくタップ操作で遷移)
 *
 * 認可:
 *   - ログイン必須
 *   - 該当イベントの CallTicket を保有していること必須
 */
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@idol/db';
import { WaitingRoom } from './WaitingRoom';
import { formatJstDateTime } from '@idol/shared';

export const runtime = 'nodejs';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CallWaitingPage({ params }: PageProps) {
  const { id: eventId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/signin?callbackUrl=/call/events/${eventId}/waiting`);
  }

  const event = await prisma.callEvent.findUnique({
    where: { id: eventId },
    include: { performer: { select: { displayName: true, email: true } } },
  });
  if (!event) notFound();

  const ticket = await prisma.callTicket.findUnique({
    where: { eventId_userId: { eventId, userId: session.user.id } },
  });
  if (!ticket) {
    // チケット未引換
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-bold text-slate-900">{event.title}</h1>
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          このイベントのチケットをお持ちでないようです。
          <br />
          シリアルコードを引き換えてください。
        </div>
        <Link
          href="/call/redeem"
          className="mt-6 inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          シリアルコード引換へ
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{event.title}</h1>
        <p className="mt-1 text-sm text-slate-600">
          演者: {event.performer.displayName ?? event.performer.email}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          開始: {formatJstDateTime(event.startsAt)} / 1人 {event.perFanSeconds}{' '}
          秒
        </p>
      </header>

      <WaitingRoom
        eventId={eventId}
        ticketId={ticket.id}
        queuePos={ticket.queuePos}
        noticeText={event.noticeText}
      />
    </div>
  );
}
