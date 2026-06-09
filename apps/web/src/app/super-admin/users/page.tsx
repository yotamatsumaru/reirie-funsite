/**
 * /super-admin/users — 全ユーザー一覧 + 検索 + ロール変更 / BAN
 */
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { USER_ROLE_LABELS, type UserRoleLiteral } from '@idol/shared';
import { UserRowActions } from './user-row-actions';

export const metadata: Metadata = { title: 'ユーザー管理 | Super Admin' };
export const dynamic = 'force-dynamic';

type SearchParams = { q?: string; role?: string };

type UserRow = {
  id: string;
  email: string;
  displayName: string | null;
  fullName: string | null;
  role: UserRoleLiteral;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  marketingOptIn: boolean;
};

export default async function SuperAdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const role = sp.role ?? '';

  const allUsers = (await prisma.user.findMany({})) as unknown as UserRow[];
  const filtered = allUsers.filter((u) => {
    if (q) {
      const needle = q.toLowerCase();
      const hay = [u.email, u.displayName, u.fullName].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (role && u.role !== role) return false;
    return true;
  });

  return (
    <main>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">ユーザー管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          全 {allUsers.length} 名 / 検索結果 {filtered.length} 件
        </p>
      </header>

      {/* 検索フォーム */}
      <Card className="mb-4">
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                キーワード (Email / 名前)
              </label>
              <input
                name="q"
                defaultValue={q}
                placeholder="例: fan01@example.com"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">ロール</label>
              <select
                name="role"
                defaultValue={role}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">すべて</option>
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
              </select>
            </div>
            <button
              type="submit"
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
            >
              検索
            </button>
          </form>
        </CardBody>
      </Card>

      {/* テーブル */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">ユーザー</th>
                  <th className="px-4 py-3">ロール</th>
                  <th className="px-4 py-3">状態</th>
                  <th className="px-4 py-3">登録日</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                      該当するユーザーが見つかりません。
                    </td>
                  </tr>
                )}
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">
                        {u.displayName ?? '（未設定）'}
                      </p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                      {u.fullName && (
                        <p className="text-xs text-slate-400">{u.fullName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-4 py-3">
                      {u.deletedAt ? (
                        <Badge tone="danger">BAN 済み</Badge>
                      ) : (
                        <Badge tone="success">アクティブ</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {formatDate(new Date(u.createdAt))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <UserRowActions
                        userId={u.id}
                        currentRole={u.role}
                        isBanned={!!u.deletedAt}
                      />
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

function RoleBadge({ role }: { role: UserRoleLiteral }) {
  if (role === 'SUPER_ADMIN') return <Badge tone="danger">{USER_ROLE_LABELS[role]}</Badge>;
  if (role === 'ADMIN') return <Badge tone="brand">{USER_ROLE_LABELS[role]}</Badge>;
  return <Badge tone="gray">{USER_ROLE_LABELS[role]}</Badge>;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
