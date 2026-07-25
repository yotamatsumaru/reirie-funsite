/**
 * /super-admin/admins — ADMIN / SUPER_ADMIN ロール所有者の一覧と付与・剥奪
 */
import Link from 'next/link';
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import { auth } from '@/auth';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  USER_ROLE_LABELS,
  type UserRoleLiteral,
  normalizeAdminCapabilities,
  type AdminCapabilityLiteral,
  ADMIN_CAPABILITY_LABELS,
} from '@idol/shared';
import { AdminRowActions } from './admin-row-actions';
import { AdminCapabilityEditor } from './admin-capability-editor';
import { GrantAdminForm } from './grant-admin-form';
import { InviteAdminForm } from './invite-admin-form';
import { InvitationList, type InvitationItem } from './invitation-list';
import { SetMemberNumberForm } from './set-member-number-form';

export const metadata: Metadata = { title: '管理者管理 | Super Admin' };
export const dynamic = 'force-dynamic';

type UserRow = {
  id: string;
  email: string;
  displayName: string | null;
  fullName: string | null;
  role: UserRoleLiteral;
  adminCapabilities: string[] | null;
  deletedAt: Date | null;
  createdAt: Date;
};

export default async function SuperAdminAdminsPage() {
  // スタッフ管理者は閲覧のみ (権限付与/招待/剥奪/会員番号変更などは不可)
  const viewerSession = await auth();
  const readOnly = viewerSession?.user?.role === 'STAFF';

  const allUsers = (await prisma.user.findMany({})) as unknown as UserRow[];
  const admins = allUsers.filter(
    (u) => u.role === 'ADMIN' || u.role === 'STAFF' || u.role === 'SUPER_ADMIN',
  );
  const supers = admins.filter((u) => u.role === 'SUPER_ADMIN');
  const staffs = admins.filter((u) => u.role === 'STAFF');
  const regularAdmins = admins.filter((u) => u.role === 'ADMIN');

  // 期限切れの PENDING を EXPIRED に揃えてから取得
  await prisma.adminInvitation.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
  const invitationRows = await prisma.adminInvitation.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      invitedBy: { select: { email: true, displayName: true } },
      acceptedBy: { select: { email: true, displayName: true } },
    },
  });
  const invitations: InvitationItem[] = invitationRows.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role as InvitationItem['role'],
    status: inv.status as InvitationItem['status'],
    note: inv.note,
    expiresAt: inv.expiresAt.toISOString(),
    acceptedAt: inv.acceptedAt ? inv.acceptedAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString(),
    invitedBy: inv.invitedBy
      ? { email: inv.invitedBy.email, displayName: inv.invitedBy.displayName }
      : null,
    acceptedBy: inv.acceptedBy
      ? { email: inv.acceptedBy.email, displayName: inv.acceptedBy.displayName }
      : null,
  }));
  const pendingCount = invitations.filter((i) => i.status === 'PENDING').length;

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
          <AdminTable users={supers} readOnly={readOnly} />
        </CardBody>
      </Card>

      {/* STAFF セクション */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              スタッフ管理者 ({staffs.length} 名)
            </h2>
            <Badge tone="info">STAFF（閲覧のみ）</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            スーパー管理者と同じ画面を閲覧できますが、返金・BAN・ロール変更などの書き込み操作はできません。
          </p>
        </CardHeader>
        <CardBody className="p-0">
          <AdminTable users={staffs} readOnly={readOnly} />
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
          <AdminTable users={regularAdmins} readOnly={readOnly} />
        </CardBody>
      </Card>

      {!readOnly && (
        <>
          {/* 付与フォーム（既存ユーザーの即時昇格） */}
          <Card className="mb-6">
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-800">既存ユーザーを管理者に昇格（即時）</h2>
              <p className="mt-1 text-xs text-slate-500">
                すでにアカウントを持つユーザーのメールアドレスを指定して、その場で権限を付与します。
                メール承認のステップはありません。
              </p>
            </CardHeader>
            <CardBody>
              <GrantAdminForm />
            </CardBody>
          </Card>

          {/* メール招待フォーム（新規・既存両対応） */}
          <Card className="mb-6">
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-800">メールで管理者を招待</h2>
              <p className="mt-1 text-xs text-slate-500">
                アカウント未作成の人・既存ユーザーのどちらにも送信できます。
                招待された本人がメール内のリンクから承認すると、管理者権限が付与されます。
              </p>
            </CardHeader>
            <CardBody>
              <InviteAdminForm />
            </CardBody>
          </Card>
        </>
      )}

      {/* 招待一覧 */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">
            招待一覧{pendingCount > 0 ? `（招待中 ${pendingCount} 件）` : ''}
          </h2>
        </CardHeader>
        <CardBody className="p-0">
          <InvitationList invitations={invitations} readOnly={readOnly} />
        </CardBody>
      </Card>

      {/* 既存ユーザーの会員番号を直接変更 (記念番号の割り当てなど) */}
      {!readOnly && (
        <Card className="mt-6">
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-800">会員番号を変更</h2>
            <p className="mt-1 text-xs text-slate-500">
              すでにアカウントを持つユーザー (管理者・スーパー管理者を含む) の会員番号を、
              メールアドレスを指定して直接書き換えます。
            </p>
          </CardHeader>
          <CardBody>
            <SetMemberNumberForm />
          </CardBody>
        </Card>
      )}
    </main>
  );
}

function AdminTable({ users, readOnly = false }: { users: UserRow[]; readOnly?: boolean }) {
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
            <th className="px-4 py-3">管理権限</th>
            <th className="px-4 py-3">登録日</th>
            {!readOnly && <th className="px-4 py-3 text-right">操作</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((u) => {
            const caps: AdminCapabilityLiteral[] = normalizeAdminCapabilities(
              u.adminCapabilities,
            );
            return (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 align-top">
                  <p className="font-medium text-slate-900">
                    {u.displayName ?? '（未設定）'}
                  </p>
                  <p className="text-xs text-slate-500">{u.email}</p>
                </td>
                <td className="px-4 py-3 align-top">
                  {u.role === 'SUPER_ADMIN' ? (
                    <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                      全権限（スーパー管理者）
                    </span>
                  ) : u.role === 'STAFF' ? (
                    <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                      閲覧のみ（スタッフ管理者）
                    </span>
                  ) : readOnly ? (
                    <div className="flex flex-wrap gap-1">
                      {caps.length === 0 ? (
                        <span className="text-xs text-slate-400">権限なし</span>
                      ) : (
                        caps.map((c) => (
                          <span
                            key={c}
                            className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700"
                          >
                            {ADMIN_CAPABILITY_LABELS[c]}
                          </span>
                        ))
                      )}
                    </div>
                  ) : (
                    <AdminCapabilityEditor userId={u.id} initialCapabilities={caps} />
                  )}
                </td>
                <td className="px-4 py-3 align-top text-xs text-slate-600">
                  {new Date(u.createdAt).toLocaleDateString('ja-JP')}
                </td>
                {!readOnly && (
                  <td className="px-4 py-3 text-right align-top">
                    <AdminRowActions userId={u.id} currentRole={u.role} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
