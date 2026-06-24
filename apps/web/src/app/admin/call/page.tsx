/**
 * /admin/call — 演者側の 1on1 通話待機ルーム
 *
 * - ADMIN / SUPER_ADMIN がアクセス可能 (layout 側で既にチェック済み)
 * - 自分の userId をルーム ID として使う
 * - 「ファン用 URL」を表示してコピーできる
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CallRoom } from '@/components/call/CallRoom';
import { ShareUrl } from '@/components/call/ShareUrl';
import { requireCapabilityPage } from '@/auth';

export const metadata: Metadata = { title: '1on1 コール (演者)' };
export const dynamic = 'force-dynamic';

export default async function AdminCallPage() {
  await requireCapabilityPage('CALL');
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/admin/call');

  const roomId = session.user.id;

  // ファン用 URL を組み立て (origin はリクエストヘッダから取得)
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const fanUrl = `${proto}://${host}/call/${roomId}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">1on1 コール</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          ファンと 1 対 1 で音声・ビデオ通話ができます。下記の URL をファンに共有してください。
        </p>
      </header>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">ファン用 URL</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <ShareUrl url={fanUrl} />
          <p className="text-xs text-slate-500">
            ※ ファンはログインした状態でこの URL にアクセスする必要があります。
          </p>
        </CardBody>
      </Card>

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
