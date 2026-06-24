/**
 * /admin-invite/[token] — 管理者招待の受諾ページ
 *
 * サーバー側で招待トークンの有効性を確認し、
 *  - 無効/期限切れ → エラー表示
 *  - 既存ユーザー → ログインのうえ承認するフォーム
 *  - 新規ユーザー → アカウント作成して承認するフォーム
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { USER_ROLE_LABELS } from '@idol/shared';
import { isInvitationAcceptable } from '@/lib/admin-invitation';
import { AcceptInviteForm } from '@/components/admin-invite/AcceptInviteForm';

export const metadata: Metadata = { title: '管理者招待の承認' };
export const dynamic = 'force-dynamic';

export default async function AdminInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invitation = await prisma.adminInvitation.findUnique({ where: { token } });

  if (!invitation || !isInvitationAcceptable(invitation)) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="mb-4 text-2xl font-bold text-slate-800">管理者招待</h1>
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <p className="font-semibold">この招待は使用できません。</p>
          <p className="mt-1">
            招待の有効期限が切れているか、取消・受諾済みの可能性があります。
            招待者に再送を依頼してください。
          </p>
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">
          <Link href="/" className="text-brand-600 hover:underline">
            トップへ戻る
          </Link>
        </p>
      </div>
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, deletedAt: true },
  });

  if (existingUser?.deletedAt) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="mb-4 text-2xl font-bold text-slate-800">管理者招待</h1>
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          このアカウントは現在利用できないため、招待を受諾できません。
        </div>
      </div>
    );
  }

  const isExistingUser = !!existingUser;
  const session = await auth();
  const loggedInAsInvitee =
    !!session?.user?.id && session.user.email === invitation.email;
  const roleLabel = USER_ROLE_LABELS[invitation.role];

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-slate-800">管理者招待の承認</h1>
      <p className="mb-6 text-sm text-slate-600">
        <span className="font-semibold text-twilight-amethyst">{roleLabel}</span>{' '}
        として招待されています。
      </p>

      <div className="mb-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <dl className="space-y-1">
          <div className="flex justify-between">
            <dt className="text-slate-500">メールアドレス</dt>
            <dd className="font-medium">{invitation.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">付与される権限</dt>
            <dd className="font-medium">{roleLabel}</dd>
          </div>
        </dl>
      </div>

      <AcceptInviteForm
        token={token}
        email={invitation.email}
        isExistingUser={isExistingUser}
        loggedInAsInvitee={loggedInAsInvitee}
      />
    </div>
  );
}
