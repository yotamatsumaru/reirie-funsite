/**
 * GET /api/super-admin/sales/export
 *   - 決済履歴 (Payment) を CSV でダウンロード (SUPER_ADMIN 限定)
 *   - クエリ: kind / status / q (/super-admin/sales の絞り込みと同じ条件)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { handle } from '@/lib/errors';
import { toCsv } from '@/lib/csv';
import { PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS } from '@idol/shared';

export const runtime = 'nodejs';

type PaymentKindKey = keyof typeof PAYMENT_KIND_LABELS;
type PaymentStatusKey = keyof typeof PAYMENT_STATUS_LABELS;

interface PaymentRow {
  id: string;
  kind: PaymentKindKey;
  status: PaymentStatusKey;
  amount: number;
  currency: string;
  createdAt: Date;
  user?: { email: string; displayName: string | null } | null;
  order?: { orderNumber: string } | null;
  subscription?: { planType: string } | null;
}

export const GET = handle(async (req: Request) => {
  await requireSuperAdmin();
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') ?? '';
  const status = url.searchParams.get('status') ?? '';
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';

  const payments = (await prisma.payment.findMany({
    include: {
      user: { select: { email: true, displayName: true } },
      order: { select: { orderNumber: true } },
      subscription: { select: { planType: true } },
    },
    orderBy: { createdAt: 'desc' },
  })) as unknown as PaymentRow[];

  const filtered = payments.filter((p) => {
    if (kind && p.kind !== kind) return false;
    if (status && p.status !== status) return false;
    if (q) {
      const hay = [p.user?.email ?? '', p.user?.displayName ?? '', p.order?.orderNumber ?? '']
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const rows: string[][] = [
    ['id', 'kind', 'status', 'amount', 'currency', 'user_email', 'user_name', 'order_number', 'plan_type', 'created_at'],
  ];
  for (const p of filtered) {
    rows.push([
      p.id,
      PAYMENT_KIND_LABELS[p.kind] ?? p.kind,
      PAYMENT_STATUS_LABELS[p.status] ?? p.status,
      String(p.amount),
      p.currency,
      p.user?.email ?? '',
      p.user?.displayName ?? '',
      p.order?.orderNumber ?? '',
      p.subscription?.planType ?? '',
      p.createdAt.toISOString(),
    ]);
  }

  const body = toCsv(rows);
  const filename = `sales-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
