/**
 * /super-admin/users/[id] — ファンユーザーの詳細情報
 *
 * プロフィール全項目・ログイン日数/最終ログイン・保有ポイント・注文履歴・
 * 会員ランク・監査ログ・警告履歴 をまとめて表示する。
 * BAN / 復活 / ロール変更は一覧と同じ UserRowActions を再利用する。
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { RankBadge } from '@/components/membership/RankBadge';
import { UserRowActions } from '../user-row-actions';
import { WarningPanel, type WarningItem } from './warning-panel';
import { PromoPanel } from './promo-panel';
import { getMemberRank } from '@/lib/membership-rank';
import { getMemberRankTiers } from '@/lib/app-setting';
import { ORDER_STATUS_LABELS } from '@idol/shared';

export const metadata: Metadata = { title: 'ユーザー詳細 | Super Admin' };
export const dynamic = 'force-dynamic';

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function SuperAdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== 'USER') notFound();

  const [rankTiers, orders, warningsRaw, auditLogs, subscription] = await Promise.all([
    getMemberRankTiers(),
    prisma.order.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
      },
    }),
    prisma.userWarning.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reason: true,
        emailSent: true,
        emailError: true,
        createdAt: true,
        issuedBy: { select: { id: true, displayName: true, email: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { OR: [{ userId: id }, { resource: `user:${id}` }] },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.subscription.findFirst({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const { rank, metrics } = await getMemberRank(id, rankTiers);

  const warnings: WarningItem[] = warningsRaw.map((w) => ({
    id: w.id,
    reason: w.reason,
    emailSent: w.emailSent,
    emailError: w.emailError,
    createdAt: w.createdAt.toISOString(),
    issuedBy: w.issuedBy
      ? { id: w.issuedBy.id, displayName: w.issuedBy.displayName, email: w.issuedBy.email }
      : null,
  }));

  return (
    <main>
      <div className="mb-5">
        <Link href="/super-admin/users" className="text-sm text-slate-500 hover:text-slate-700">
          ← ファンユーザー管理へ戻る
        </Link>
      </div>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
            {user.displayName ?? '（未設定）'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{user.email}</p>
          <div className="mt-2 flex items-center gap-2">
            {user.deletedAt ? (
              user.bannedAt ? (
                <Badge tone="danger">運営BAN</Badge>
              ) : (
                <Badge tone="gray">自己退会</Badge>
              )
            ) : (
              <Badge tone="success">アクティブ</Badge>
            )}
            <RankBadge rank={rank} size="sm" />
            {user.memberNumber && (
              <span className="text-xs text-slate-400">会員番号: {user.memberNumber}</span>
            )}
          </div>
        </div>
        <UserRowActions
          userId={user.id}
          currentRole={user.role}
          isBanned={!!user.deletedAt}
          showRoleSelect={false}
        />
      </header>

      {user.deletedAt && user.bannedAt && (
        <Card className="mb-4 border-rose-200 bg-rose-50">
          <CardBody>
            <p className="text-sm font-semibold text-rose-700">
              運営により BAN されています ({formatDateTime(user.bannedAt)})
            </p>
            <p className="mt-1 text-sm text-rose-600">
              理由: {user.banReason || '(理由未記入)'}
            </p>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* プロフィール詳細 */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-800">プロフィール</h2>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <Field label="氏名" value={user.fullName} />
              <Field label="フリガナ" value={user.furigana} />
              <Field label="電話番号" value={user.phone} />
              <Field label="生年月日" value={formatDate(user.birthDate)} />
              <Field label="郵便番号" value={user.postalCode} />
              <Field label="都道府県" value={user.prefecture} />
              <Field
                label="住所"
                value={[user.addressLine1, user.addressLine2].filter(Boolean).join(' ') || null}
              />
              <Field label="呼んでほしい名前" value={user.preferredName} />
              <Field label="メール認証" value={user.emailVerified ? formatDateTime(user.emailVerified) : '未認証'} />
              <Field label="マーケティング同意" value={user.marketingOptIn ? '同意あり' : 'なし'} />
              <Field label="登録日" value={formatDateTime(user.createdAt)} />
            </dl>
          </CardBody>
        </Card>

        {/* アカウント状態 / アクティビティ */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-800">アカウント情報</h2>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <Field label="最終ログイン" value={formatDateTime(user.lastLoginAt)} />
              <Field label="ログイン日数" value={`${metrics.loginDays} 日`} />
              <Field label="買い物回数" value={`${metrics.purchaseCount} 回`} />
              <Field label="保有 Fan ポイント" value={`${user.points.toLocaleString()} pt`} />
              <Field label="保有 特典ポイント" value={`${user.rewardPoints.toLocaleString()} pt`} />
              <Field
                label="サブスクリプション"
                value={subscription ? `${subscription.planType} (${subscription.status})` : 'なし'}
              />
              <Field
                label="ログイン失敗回数"
                value={`${user.failedLoginAttempts} 回`}
              />
              <Field
                label="ロック状態"
                value={
                  user.lockedUntil && user.lockedUntil > new Date()
                    ? `ロック中 (〜${formatDateTime(user.lockedUntil)})`
                    : 'ロックなし'
                }
              />
              <Field label="TOTP (2段階認証)" value={user.totpEnabled ? '有効' : '無効'} />
              <Field
                label="プロモ/デモ"
                value={
                  user.promoUntil
                    ? user.promoUntil > new Date()
                      ? `有効 (〜${formatDateTime(user.promoUntil)})`
                      : `期限切れ (${formatDateTime(user.promoUntil)})`
                    : 'なし'
                }
              />
            </dl>
          </CardBody>
        </Card>
      </div>

      {/* 注文履歴 */}
      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">注文履歴 (直近10件)</h2>
        </CardHeader>
        <CardBody className="p-0">
          {orders.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">注文履歴はありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2">注文番号</th>
                    <th className="px-4 py-2">状態</th>
                    <th className="px-4 py-2 text-right">金額</th>
                    <th className="px-4 py-2">日時</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="px-4 py-2 font-mono text-xs">{o.orderNumber}</td>
                      <td className="px-4 py-2">
                        {ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS] ?? o.status}
                      </td>
                      <td className="px-4 py-2 text-right">¥{o.totalAmount.toLocaleString()}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">
                        {formatDateTime(o.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* プロモ/デモアカウント */}
      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">プロモ/デモアカウント</h2>
          <p className="mt-1 text-xs text-slate-500">
            イベント配布用のデモアカウント設定。付与するとミニゲームが回数無制限＋勝率PREMIUM相当になります。
          </p>
        </CardHeader>
        <CardBody>
          <PromoPanel
            userId={user.id}
            initialPromoUntil={user.promoUntil ? user.promoUntil.toISOString() : null}
          />
        </CardBody>
      </Card>

      {/* 警告通知 */}
      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">警告通知（メール送信のみ）</h2>
          <p className="mt-1 text-xs text-slate-500">
            理由を入力して送信すると、このユーザーへ警告メールが送られ、履歴として記録されます。
          </p>
        </CardHeader>
        <CardBody>
          <WarningPanel userId={user.id} initialWarnings={warnings} />
        </CardBody>
      </Card>

      {/* 監査ログ */}
      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">監査ログ (直近20件)</h2>
        </CardHeader>
        <CardBody className="p-0">
          {auditLogs.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">監査ログはありません。</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <li key={log.id} className="px-4 py-2 text-xs text-slate-600">
                  <span className="mr-2 font-mono text-slate-800">{log.action}</span>
                  <span className="text-slate-400">{formatDateTime(log.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value || '—'}</dd>
    </>
  );
}
