/**
 * /super-admin/users — ファンユーザー (role=USER) の一覧 + 検索 + BAN / ロール変更
 *
 * 管理者 (ADMIN / SUPER_ADMIN) はこの画面には表示しません。
 * 管理者の一覧・付与・剥奪は /super-admin/admins で行います。
 */
import Link from 'next/link';
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { type UserRoleLiteral } from '@idol/shared';
import { UserRowActions } from './user-row-actions';

export const metadata: Metadata = { title: 'ファンユーザー管理 | Super Admin' };
export const dynamic = 'force-dynamic';

type SearchParams = { q?: string };

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

  // ファンユーザー (role=USER) のみを対象にする。管理者はこの画面に表示しない。
  const fanUsers = (await prisma.user.findMany({
    where: { role: 'USER' },
    orderBy: { createdAt: 'desc' },
  })) as unknown as UserRow[];

  const filtered = fanUsers.filter((u) => {
    if (q) {
      const needle = q.toLowerCase();
      const hay = [u.email, u.displayName, u.fullName].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  return (
    <main>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">ファンユーザー管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            ファン会員 (一般ユーザー) {fanUsers.length} 名 / 検索結果 {filtered.length} 件
          </p>
        </div>
        <Link
          href="/super-admin/admins"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          管理者の管理へ →
        </Link>
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
                  <th className="px-4 py-3">状態</th>
                  <th className="px-4 py-3">登録日</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                      該当するファンユーザーが見つかりません。
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
                        showRoleSelect={false}
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

function formatDate(d: Date): string {
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
