/**
 * GET /api/super-admin/newsletter/export
 *   - 会報誌 (年2回) の発送宛名リストを CSV でダウンロード (SUPER_ADMIN 限定)
 *   - 対象: 有効な (ACTIVE / TRIALING) PREMIUM サブスクリプションを持つ会員
 *   - 個人情報 (住所) の持ち出しになるため、実行を監査ログに記録する
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { handle } from '@/lib/errors';
import { toCsv } from '@/lib/csv';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const LIVE_STATUSES = ['ACTIVE', 'TRIALING'] as const;

type NewsletterUser = {
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

function recipientName(u: NewsletterUser): string {
  return u.fullName?.trim() || u.displayName?.trim() || '';
}

function formatPostalCode(pc: string | null): string {
  if (!pc) return '';
  const digits = pc.replace(/[^0-9]/g, '');
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return pc;
}

function isShippable(u: NewsletterUser): boolean {
  return Boolean(
    recipientName(u) && u.postalCode?.trim() && u.prefecture?.trim() && u.addressLine1?.trim(),
  );
}

export const GET = handle(async (req: Request) => {
  const session = await requireSuperAdminView();

  const subs = (await prisma.subscription.findMany({
    where: {
      planType: 'PREMIUM',
      status: { in: [...LIVE_STATUSES] },
    },
    select: {
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
  })) as unknown as Array<{ status: string; currentPeriodEnd: Date; user: NewsletterUser | null }>;

  // 1 会員が複数の有効 PREMIUM サブスクを持つ場合に備え user.id で重複排除。
  const seen = new Set<string>();
  const rows: string[][] = [
    [
      '会員番号',
      '氏名',
      'ふりがな',
      '郵便番号',
      '都道府県',
      '住所1',
      '住所2',
      '電話番号',
      'メールアドレス',
      '契約状態',
      '現契約期間終了日',
      '発送可否',
    ],
  ];

  let shippableCount = 0;
  for (const s of subs) {
    const u = s.user;
    if (!u || seen.has(u.id)) continue;
    seen.add(u.id);
    const shippable = isShippable(u);
    if (shippable) shippableCount += 1;
    rows.push([
      u.memberNumber ?? '',
      recipientName(u),
      u.furigana ?? '',
      formatPostalCode(u.postalCode),
      u.prefecture ?? '',
      u.addressLine1 ?? '',
      u.addressLine2 ?? '',
      u.phone ?? '',
      u.email,
      s.status,
      s.currentPeriodEnd.toISOString().slice(0, 10),
      shippable ? '発送可' : '要確認',
    ]);
  }

  await logAudit({
    userId: session.user.id,
    action: 'newsletter.export',
    resource: 'subscriptions',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: {
      recipients: seen.size,
      shippable: shippableCount,
      needsInfo: seen.size - shippableCount,
    },
  });

  const body = toCsv(rows);
  const filename = `newsletter-recipients-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
