/**
 * /super-admin/newsletter — 会報誌 発送リスト (SUPER_ADMIN 限定)
 *
 * PREMIUM プランの特典「会報誌 (年2回)」を発送するための宛名リスト。
 *  - 対象: 有効な (ACTIVE / TRIALING) PREMIUM サブスクリプションを持つ会員
 *  - 会員の登録住所 (User.postalCode / prefecture / addressLine1 / addressLine2) を表示
 *  - 住所や氏名が未入力の会員は「要確認」として明示し、発送前に補完できるようにする
 *  - CSV ダウンロード (/api/super-admin/newsletter/export) で宛名ラベル作成に利用可能
 *
 * 個人情報 (住所) を扱う画面のため、レイアウト側で SUPER_ADMIN のみに制限している。
 */
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: '会報誌 発送リスト | Super Admin' };
export const dynamic = 'force-dynamic';

/** 有効 (発送対象) とみなすサブスクステータス */
const LIVE_STATUSES = ['ACTIVE', 'TRIALING'] as const;

type Recipient = {
  subscriptionId: string;
  status: string;
  currentPeriodEnd: Date;
  user: {
    id: string;
    email: string;
    memberNumber: string | null;
    fullName: string | null;
    furigana: string | null;
    displayName: string | null;
    phone: string | null;
    postalCode: string | null;
    prefecture: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
  };
};

/** 宛名として使う氏名 (本名 > 表示名) */
function recipientName(u: Recipient['user']): string {
  return u.fullName?.trim() || u.displayName?.trim() || '';
}

/** 郵便番号を 123-4567 形式へ整形 (数字7桁のときのみ) */
function formatPostalCode(pc: string | null): string {
  if (!pc) return '';
  const digits = pc.replace(/[^0-9]/g, '');
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return pc;
}

/** 都道府県 + 住所1 + 住所2 を1行に連結 */
function fullAddress(u: Recipient['user']): string {
  return [u.prefecture, u.addressLine1, u.addressLine2]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(' ');
}

/** 発送に必要な情報 (氏名・郵便番号・都道府県・住所1) が揃っているか */
function isShippable(u: Recipient['user']): boolean {
  return Boolean(
    recipientName(u) && u.postalCode?.trim() && u.prefecture?.trim() && u.addressLine1?.trim(),
  );
}

export default async function NewsletterMailingListPage() {
  const subs = (await prisma.subscription.findMany({
    where: {
      planType: 'PREMIUM',
      status: { in: [...LIVE_STATUSES] },
    },
    select: {
      id: true,
      status: true,
      currentPeriodEnd: true,
      user: {
        select: {
          id: true,
          email: true,
          memberNumber: true,
          fullName: true,
          furigana: true,
          displayName: true,
          phone: true,
          postalCode: true,
          prefecture: true,
          addressLine1: true,
          addressLine2: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })) as unknown as Array<{
    id: string;
    status: string;
    currentPeriodEnd: Date;
    user: Recipient['user'];
  }>;

  // 1 会員が複数の有効 PREMIUM サブスクを持つ理論上のケースに備え、user.id で重複排除する。
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const s of subs) {
    if (!s.user || seen.has(s.user.id)) continue;
    seen.add(s.user.id);
    recipients.push({
      subscriptionId: s.id,
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd,
      user: s.user,
    });
  }

  const shippableCount = recipients.filter((r) => isShippable(r.user)).length;
  const needsInfoCount = recipients.length - shippableCount;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">会報誌 発送リスト</h1>
          <p className="mt-1 text-sm text-slate-500">
            PREMIUM 会員（有効な契約）への「会報誌（年2回）」発送用の宛名リストです。
          </p>
        </div>
        <a
          href="/api/super-admin/newsletter/export"
          className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700"
        >
          CSV をダウンロード
        </a>
      </header>

      {/* KPI カード */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">発送対象（PREMIUM 会員）</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{recipients.length}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">住所そろい・発送可能</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{shippableCount}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">住所未入力・要確認</p>
            <p className={`mt-1 text-2xl font-bold ${needsInfoCount > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
              {needsInfoCount}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">宛名一覧</h2>
            <span className="text-xs text-slate-400">{recipients.length} 件</span>
          </div>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          {recipients.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">
              現在、発送対象の PREMIUM 会員はいません。
            </p>
          ) : (
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">会員番号</th>
                  <th className="px-4 py-2 font-medium">氏名 / ふりがな</th>
                  <th className="px-4 py-2 font-medium">郵便番号</th>
                  <th className="px-4 py-2 font-medium">住所</th>
                  <th className="px-4 py-2 font-medium">電話</th>
                  <th className="px-4 py-2 font-medium">状態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recipients.map((r) => {
                  const u = r.user;
                  const shippable = isShippable(u);
                  const name = recipientName(u);
                  return (
                    <tr key={r.subscriptionId} className={shippable ? '' : 'bg-amber-50/60'}>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">
                        {u.memberNumber ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-800">
                          {name || <span className="text-amber-600">（氏名未入力）</span>}
                        </div>
                        {u.furigana && (
                          <div className="text-xs text-slate-400">{u.furigana}</div>
                        )}
                        <div className="text-xs text-slate-400">{u.email}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {formatPostalCode(u.postalCode) || (
                          <span className="text-amber-600">未入力</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {fullAddress(u) || <span className="text-amber-600">未入力</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {u.phone ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {shippable ? (
                          <Badge tone="success">発送可</Badge>
                        ) : (
                          <Badge tone="warning">要確認</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-slate-400">
        ※ 住所・氏名は会員がマイページで登録した情報です。「要確認」の会員は発送前に本人へ確認してください。
      </p>
    </div>
  );
}
