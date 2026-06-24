/**
 * /super-admin/admins — ADMIN / SUPER_ADMIN ロール所有者の一覧と付与・剥奪
 */
import Link from 'next/link';
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { USER_ROLE_LABELS, type UserRoleLiteral } from '@idol/shared';
import { AdminRowActions } from './admin-row-actions';
import { GrantAdminForm } from './grant-admin-form';

export const metadata: Metadata = { title: '管理者管理 | Super Admin' };
export const dynamic = 'force-dynamic';

type UserRow = {
  id: string;
  email: string;
  displayName: string | null;
  fullName: string | null;
  role: UserRoleLiteral;
  deletedAt: Date | null;
  createdAt: Date;
};

export default async function SuperAdminAdminsPage() {
  const allUsers = (await prisma.user.findMany({})) as unknown as UserRow[];
  const admins = allUsers.filter(
    (u) => u.role === 'ADMIN' || u.role === 'SUPER_ADMIN',
  );
  const supers = admins.filter((u) => u.role === 'SUPER_ADMIN');
  const regularAdmins = admins.filter((u) => u.role === 'ADMIN');

  return (
    <main>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">管理者管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            ADMIN / SUPER_ADMIN ロールの付与・剥奪を行います。ファン会員はこの画面には表示されません。
          </p>
        </div>
        <Link
          href="/super-admin/users"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ← ファンユーザーの管理へ
        </Link>
      </header>

      {/* 警告 */}
      <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">⚠ 重要</p>
        <p className="mt-1">
          SUPER_ADMIN は KPI 閲覧・ユーザー BAN・課金強制操作など、すべての権限を持ちます。
          付与は信頼できるスタッフのみに限定してください。
        </p>
      </div>

      {/* SUPER_ADMIN セクション */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              スーパー管理者 ({supers.length} 名)
            </h2>
            <Badge tone="danger">SUPER_ADMIN</Badge>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <AdminTable users={supers} />
        </CardBody>
      </Card>

      {/* ADMIN セクション */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              管理者 ({regularAdmins.length} 名)
            </h2>
            <Badge tone="brand">ADMIN</Badge>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <AdminTable users={regularAdmins} />
        </CardBody>
      </Card>

      {/* 付与フォーム（既存ユーザーの即時昇格） */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">既存ユーザーを管理者に昇格</h2>
          <p className="mt-1 text-xs text-slate-500">
            すでにアカウントを持つユーザーのメールアドレスを指定して、その場で権限を付与します。
            （アカウント未作成の人へのメール招待は今後追加予定）
          </p>
        </CardHeader>
        <CardBody>
          <GrantAdminForm />
        </CardBody>
      </Card>
    </main>
  );
}

function AdminTable({ users }: { users: UserRow[] }) {
  if (users.length === 0) {
    return (
      <p className="px-5 py-6 text-center text-sm text-slate-500">該当する管理者はいません。</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-3">ユーザー</th>
            <th className="px-4 py-3">登録日</th>
            <th className="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <p className="font-medium text-slate-900">
                  {u.displayName ?? '（未設定）'}
                </p>
                <p className="text-xs text-slate-500">{u.email}</p>
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">
                {new Date(u.createdAt).toLocaleDateString('ja-JP')}
              </td>
              <td className="px-4 py-3 text-right">
                <AdminRowActions userId={u.id} currentRole={u.role} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
