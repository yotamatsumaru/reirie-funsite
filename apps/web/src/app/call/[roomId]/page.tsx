/**
 * /call/[roomId] — ファン側の 1on1 通話ページ
 *
 * - ログイン必須 (未ログインなら /signin に飛ばす)
 * - roomId は演者の userId
 */
import type { Metadata } from 'next';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CallRoom } from '@/components/call/CallRoom';

export const metadata: Metadata = { title: '1on1 コール' };
export const dynamic = 'force-dynamic';

export default async function FanCallPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/signin?callbackUrl=/call/${encodeURIComponent(roomId)}`);
  }

  // ルームの主 (演者) を確認 — 存在しない or ADMIN/SUPER_ADMIN でなければ無効
  const performer = await prisma.user.findUnique({
    where: { id: roomId },
    select: { id: true, displayName: true, email: true, role: true, deletedAt: true },
  });

  const performerValid =
    performer &&
    performer.deletedAt === null &&
    (performer.role === 'ADMIN' || performer.role === 'SUPER_ADMIN');

  return (
    <main className="mx-auto max-w-5xl px-3 py-6 sm:px-4 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">1on1 コール</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          演者と 1 対 1 で音声・ビデオ通話ができます。
        </p>
      </header>

      {!performerValid ? (
        <Card>
          <CardBody>
            <p className="text-sm text-rose-700">
              このコールルームは存在しないか、無効になっています。URL をご確認ください。
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">
              通話相手: {performer.displayName ?? performer.email}
            </h2>
          </CardHeader>
          <CardBody>
            <CallRoom
              roomId={roomId}
              role="fan"
              peerLabel={performer.displayName ?? performer.email}
            />
          </CardBody>
        </Card>
      )}
    </main>
  );
}
