/**
 * /call/events/[id]/main
 *
 * ファン側の本ルーム。アイドルと 1on1 通話する。
 *
 * 認可:
 *   - ログイン必須
 *   - 自分のチケット status が IN_MAIN_ROOM であること必須
 *     (待機室ではなく管理者から呼ばれている人だけが入れる)
 *
 * 既存の CallRoom コンポーネントをそのまま流用する。
 * roomId は `event:<eventId>` 形式とする (PR #10 で実装した HUB はキー名を問わない)。
 */
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@idol/db';
import { CallRoom } from '@/components/call/CallRoom';

export const runtime = 'nodejs';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CallEventMainPage({ params }: PageProps) {
  const { id: eventId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/signin?callbackUrl=/call/events/${eventId}/main`);
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
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-bold text-slate-900">アクセス不可</h1>
        <p className="mt-4 text-sm text-slate-600">
          このイベントのチケットをお持ちでないため本ルームに入室できません。
        </p>
        <Link href="/call/redeem" className="mt-6 inline-block text-sm text-brand-700 hover:underline">
          シリアル引換へ
        </Link>
      </div>
    );
  }
  if (ticket.status !== 'IN_MAIN_ROOM') {
    // 待機室にリダイレクト (まだ呼ばれていない / 終了済み)
    redirect(`/call/events/${eventId}/waiting`);
  }

  const roomId = `event:${eventId}`;
  const peerLabel = event.performer.displayName ?? event.performer.email;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-slate-900">{event.title} — 通話中</h1>
        <p className="mt-1 text-xs text-slate-500">
          演者: {peerLabel} / 持ち時間 {event.perFanSeconds} 秒
        </p>
      </header>
      <CallRoom roomId={roomId} role="fan" peerLabel={peerLabel} />
      <p className="mt-4 text-center text-xs text-slate-500">
        ※ 通話終了後はこの画面を閉じてもかまいません。
      </p>
    </div>
  );
}
