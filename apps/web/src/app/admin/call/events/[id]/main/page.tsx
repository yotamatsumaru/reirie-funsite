/**
 * /admin/call/events/[id]/main — 演者 (アイドル) 側の本ルーム画面
 *
 * - ADMIN/SUPER_ADMIN のみ (layout 側でガード)
 * - roomId は `event:${eventId}` 固定 (ファン側 main と一致)
 * - CallRoom を role=performer で配置
 * - スタッフはこの画面の横で 詳細ページの「次のファンを呼ぶ」を押す運用
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CallRoom } from '@/components/call/CallRoom';

export const metadata: Metadata = { title: '特典会 本ルーム (演者)' };
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminCallEventMainPage({ params }: Props) {
  const { id } = await params;
  const event = await prisma.callEvent.findUnique({
    where: { id },
    include: { performer: { select: { displayName: true, email: true } } },
  });
  if (!event) notFound();

  const roomId = `event:${event.id}`;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs text-slate-500">
          <Link href={`/admin/call/events/${event.id}`} className="hover:underline">
            ← {event.title}
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
          本ルーム (演者画面)
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          スタッフはこの画面の横で、イベント詳細ページの「次のファンを呼ぶ」ボタンを押してください。
        </p>
      </header>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">通話ルーム</h2>
        </CardHeader>
        <CardBody>
          <CallRoom roomId={roomId} role="performer" peerLabel="ファン" />
        </CardBody>
      </Card>
    </div>
  );
}
