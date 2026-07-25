/**
 * /super-admin/users — ファンユーザー (role=USER) の一覧 + 検索 + BAN / ロール変更
 *
 * 管理者 (ADMIN / SUPER_ADMIN) はこの画面には表示しません。
 * 管理者の一覧・付与・剥奪は /super-admin/admins で行います。
 *
 * タブ:
 *  - アクティブ (デフォルト): deletedAt = null のユーザー
 *  - ゴミ箱 (?tab=trash)   : deletedAt != null のユーザー (BAN済み・退会済みの両方を含む)。
 *    運営が BAN したユーザーは bannedAt が入っているため区別して表示し、
 *    「復元」を主要アクションとして目立たせる。
 */
import Link from 'next/link';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PLAN_LABELS, type PlanTypeLiteral, type UserRoleLiteral } from '@idol/shared';
import { UserRowActions } from './user-row-actions';
import { RankBadge } from '@/components/membership/RankBadge';
import { RankTiersClient } from './rank-tiers-client';
import { CreateFanUserForm } from './create-fan-user-form';
import { getMemberRankTiers } from '@/lib/app-setting';
import { getMemberRanksForUsers } from '@/lib/membership-rank';

export const metadata: Metadata = { title: 'ファンユーザー管理 | Super Admin' };
export const dynamic = 'force-dynamic';

type SearchParams = { q?: string; tab?: string };

type UserRow = {
  id: string;
  email: string;
  displayName: string | null;
  fullName: string | null;
  role: UserRoleLiteral;
  deletedAt: Date | null;
  bannedAt: Date | null;
  banReason: string | null;
  lastLoginAt: Date | null;
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

  // スタッフ管理者は閲覧のみ (作成/BAN/ランク編集は不可)
  const viewerSession = await auth();
  const readOnly = viewerSession?.user?.role === 'STAFF';
  const tab = sp.tab === 'trash' ? 'trash' : 'active';

  // ファンユーザー (role=USER) のみを対象にする。管理者はこの画面に表示しない。
  const fanUsers = (await prisma.user.findMany({
    where: { role: 'USER' },
    orderBy: { createdAt: 'desc' },
  })) as unknown as UserRow[];

  const activeUsers = fanUsers.filter((u) => !u.deletedAt);
  const trashUsers = fanUsers.filter((u) => !!u.deletedAt);
  const base = tab === 'trash' ? trashUsers : activeUsers;

  const filtered = base.filter((u) => {
    if (q) {
      const needle = q.toLowerCase();
      const hay = [u.email, u.displayName, u.fullName].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // 会員ランク (昇格条件 + 各ユーザーのランク・実績) を集計
  const rankTiers = await getMemberRankTiers();
  const ranksByUser = await getMemberRanksForUsers(
    filtered.map((u) => u.id),
    rankTiers,
  );

  // ---------------------------------------------------------------------------
  // 各ユーザーの「現在有効なプラン」を集計する。
  //   - 有効 = status が ACTIVE / TRIALING / PAST_DUE のサブスク。
  //   - 表示は最新 (createdAt desc) の 1 件をそのユーザーのプランとみなす。
  //   - 有効サブスクが 2 件以上ある場合は「二重契約」の可能性があるため
  //     activeCount で件数を持ち、一覧上で警告アイコンを出す。
  //   - 有効サブスクが 0 件なら FREE (無料会員) 扱い。
  // ---------------------------------------------------------------------------
  const filteredIds = filtered.map((u) => u.id);
  const liveSubs = filteredIds.length
    ? ((await prisma.subscription.findMany({
        where: {
          userId: { in: filteredIds },
          status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
        },
        select: {
          userId: true,
          planType: true,
          billingInterval: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      })) as unknown as Array<{
        userId: string;
        planType: PlanTypeLiteral;
        billingInterval: 'MONTH' | 'YEAR';
        createdAt: Date;
      }>)
    : [];

  const planByUser = new Map<
    string,
    { plan: PlanTypeLiteral; interval: 'MONTH' | 'YEAR'; activeCount: number }
  >();
  for (const s of liveSubs) {
    const cur = planByUser.get(s.userId);
    if (!cur) {
      // liveSubs は createdAt desc なので最初に来たものが最新
      planByUser.set(s.userId, {
        plan: s.planType,
        interval: s.billingInterval,
        activeCount: 1,
      });
    } else {
      cur.activeCount += 1;
    }
  }

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

      {/* ファンユーザーを直接登録 (会員番号を指定可能) */}
      <Card className="mb-4">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">
            ファンユーザーを直接登録
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            記念会員番号 (例: RR-000000) を割り当てたい場合など、管理画面からその場でアカウントを作成します。
          </p>
        </CardHeader>
        <CardBody>
          {!readOnly && <CreateFanUserForm />}
        </CardBody>
      </Card>

      {/* 会員ランク 昇格条件 (非公開・管理者専用) */}
      {!readOnly && <RankTiersClient initial={rankTiers} />}

      {/* タブ: アクティブ / ゴミ箱 */}
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        <Link
          href={`/super-admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`}
          className={`px-4 py-2 text-sm font-semibold ${
            tab === 'active'
              ? 'border-b-2 border-rose-600 text-rose-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          アクティブ ({activeUsers.length})
        </Link>
        <Link
          href={`/super-admin/users?tab=trash${q ? `&q=${encodeURIComponent(q)}` : ''}`}
          className={`px-4 py-2 text-sm font-semibold ${
            tab === 'trash'
              ? 'border-b-2 border-rose-600 text-rose-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          🗑️ ゴミ箱 ({trashUsers.length})
        </Link>
      </div>

      {/* 検索フォーム */}
      <Card className="mb-4">
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            {tab === 'trash' && <input type="hidden" name="tab" value="trash" />}
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
                  <th className="px-4 py-3">プラン</th>
                  <th className="px-4 py-3">ランク / ログイン</th>
                  <th className="px-4 py-3">最終ログイン</th>
                  {tab === 'trash' ? (
                    <th className="px-4 py-3">BAN理由</th>
                  ) : (
                    <th className="px-4 py-3">状態</th>
                  )}
                  <th className="px-4 py-3">登録日</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                      {tab === 'trash'
                        ? 'ゴミ箱は空です。'
                        : '該当するファンユーザーが見つかりません。'}
                    </td>
                  </tr>
                )}
                {filtered.map((u) => {
                  const ru = ranksByUser[u.id];
                  const planInfo = planByUser.get(u.id);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">
                          {u.displayName ?? '（未設定）'}
                        </p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                        {u.fullName && <p className="text-xs text-slate-400">{u.fullName}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <PlanCell info={planInfo} />
                      </td>
                      <td className="px-4 py-3">
                        {ru ? (
                          <div>
                            <RankBadge rank={ru.rank} size="sm" />
                            <p className="mt-1 text-[11px] text-slate-400">
                              ログイン {ru.metrics.loginDays}日 / 買い物 {ru.metrics.purchaseCount}回
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {u.lastLoginAt ? formatDateTime(new Date(u.lastLoginAt)) : '—'}
                      </td>
                      {tab === 'trash' ? (
                        <td className="px-4 py-3 max-w-[220px]">
                          {u.bannedAt ? (
                            <div>
                              <Badge tone="danger">運営BAN</Badge>
                              <p className="mt-1 truncate text-[11px] text-slate-500" title={u.banReason ?? ''}>
                                {u.banReason || '(理由未記入)'}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                {formatDate(new Date(u.bannedAt))}
                              </p>
                            </div>
                          ) : (
                            <Badge tone="gray">自己退会</Badge>
                          )}
                        </td>
                      ) : (
                        <td className="px-4 py-3">
                          <Badge tone="success">アクティブ</Badge>
                        </td>
                      )}
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {formatDate(new Date(u.createdAt))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <UserRowActions
                          userId={u.id}
                          currentRole={u.role}
                          isBanned={!!u.deletedAt}
                          showRoleSelect={false}
                          readOnly={readOnly}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

/** ユーザーの現在プランを表示するセル。有効サブスク 0 件なら無料会員扱い。 */
function PlanCell({
  info,
}: {
  info: { plan: PlanTypeLiteral; interval: 'MONTH' | 'YEAR'; activeCount: number } | undefined;
}) {
  if (!info) {
    return (
      <Badge tone="gray">{PLAN_LABELS.FREE}</Badge>
    );
  }
  const tone = info.plan === 'PREMIUM' ? 'danger' : 'warning';
  const intervalLabel = info.interval === 'YEAR' ? '年額' : '月額';
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone={tone}>{PLAN_LABELS[info.plan]}</Badge>
      <span className="text-[11px] text-slate-400">{intervalLabel}</span>
      {info.activeCount > 1 && (
        <span
          className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"
          title="有効なサブスクリプションが複数あります（二重契約の可能性）"
        >
          ⚠ 二重契約 {info.activeCount}件
        </span>
      )}
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
