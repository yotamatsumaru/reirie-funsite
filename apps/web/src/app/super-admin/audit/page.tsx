/**
 * /super-admin/audit — 監査ログ閲覧
 */
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: '監査ログ | Super Admin' };
export const dynamic = 'force-dynamic';

type Audit = {
  id: string;
  userId: string | null;
  action: string;
  resource: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  user?: { id: string; email: string; displayName: string | null } | null;
};

const ACTION_GROUPS: Record<string, string> = {
  user: 'ユーザー',
  auth: '認証',
  subscription: 'サブスク',
  content: 'コンテンツ',
  product: '商品',
  order: '注文',
  game: 'ゲーム',
};

function actionGroup(action: string): string {
  const prefix = action.split('.')[0] ?? '';
  return ACTION_GROUPS[prefix] ?? prefix;
}

function actionTone(action: string): 'gray' | 'brand' | 'success' | 'warning' | 'danger' | 'info' {
  if (action.includes('ban') || action.includes('delete')) return 'danger';
  if (action.includes('cancel')) return 'warning';
  if (action.includes('create') || action.includes('publish')) return 'success';
  if (action.includes('signin') || action.includes('login')) return 'info';
  if (action.includes('role')) return 'brand';
  return 'gray';
}

export default async function SuperAdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; group?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const group = sp.group ?? '';

  const logs = (await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  })) as unknown as Audit[];

  const filtered = logs.filter((l) => {
    if (q) {
      const needle = q.toLowerCase();
      const hay = [
        l.action,
        l.resource ?? '',
        l.user?.email ?? '',
        l.ipAddress ?? '',
        JSON.stringify(l.metadata ?? {}),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (group && actionGroup(l.action) !== ACTION_GROUPS[group]) return false;
    return true;
  });

  return (
    <main>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">監査ログ</h1>
        <p className="mt-1 text-sm text-slate-500">
          全管理操作の履歴 (直近 200 件 / 該当 {filtered.length} 件)
        </p>
      </header>

      {/* フィルタ */}
      <Card className="mb-4">
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                キーワード (action / resource / email / IP)
              </label>
              <input
                name="q"
                defaultValue={q}
                placeholder="例: user.ban"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                カテゴリ
              </label>
              <select
                name="group"
                defaultValue={group}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">すべて</option>
                {Object.entries(ACTION_GROUPS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
            >
              絞り込み
            </button>
          </form>
        </CardBody>
      </Card>

      {/* ログテーブル */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">日時</th>
                  <th className="px-4 py-3">実行者</th>
                  <th className="px-4 py-3">アクション</th>
                  <th className="px-4 py-3">対象リソース</th>
                  <th className="px-4 py-3">メタデータ</th>
                  <th className="px-4 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                      ログが見つかりません。
                    </td>
                  </tr>
                )}
                {filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {formatDateTime(new Date(l.createdAt))}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p className="font-medium text-slate-900">
                        {l.user?.displayName ?? l.user?.email ?? 'system'}
                      </p>
                      <p className="text-slate-500">{l.user?.email ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={actionTone(l.action)}>{l.action}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {l.resource ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {l.metadata ? (
                        <code className="block max-w-xs truncate rounded bg-slate-100 px-2 py-1 text-[11px]">
                          {JSON.stringify(l.metadata)}
                        </code>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {l.ipAddress ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
