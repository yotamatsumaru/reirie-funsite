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
import { logAudit } from '@/lib/audit';
import { PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS } from '@idol/shared';

export const runtime = 'nodejs';

// 1回のエクスポートで出力する最大件数 (メモリ・応答時間の保護)
const EXPORT_LIMIT = 5000;

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
  const session = await requireSuperAdmin();
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') ?? '';
  const status = url.searchParams.get('status') ?? '';
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';

  // kind / status は DB 側の where で絞り込む (件数上限を掛ける前に適用し、
  // 「絞り込んだのに古いレコードが上限で漏れる」ことを防ぐ)。
  // q (キーワード) は関連テーブルを跨ぐ複合条件のため取得後に JS でフィルタする。
  const payments = (await prisma.payment.findMany({
    where: {
      ...(kind ? { kind: kind as PaymentKindKey } : {}),
      ...(status ? { status: status as PaymentStatusKey } : {}),
    },
    include: {
      user: { select: { email: true, displayName: true } },
      order: { select: { orderNumber: true } },
      subscription: { select: { planType: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: EXPORT_LIMIT,
  })) as unknown as PaymentRow[];

  const filtered = payments.filter((p) => {
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

  // DB 側の where (kind/status) 適用後の件数が EXPORT_LIMIT に達している場合、
  // それより古いレコードが取得されていない可能性がある。CSV 末尾に注記を残す。
  if (payments.length >= EXPORT_LIMIT) {
    rows.push([]);
    rows.push([
      `※ 件数が上限 (${EXPORT_LIMIT}件) に達したため、これより古い決済は含まれていない可能性があります。`,
    ]);
  }

  // 財務データの持ち出しを追跡できるよう、エクスポート実行を監査ログに記録する。
  await logAudit({
    userId: session.user.id,
    action: 'sales.export',
    resource: 'payments',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: {
      kind: kind || null,
      status: status || null,
      q: q || null,
      exported: filtered.length,
      truncated: payments.length >= EXPORT_LIMIT,
    },
  });

  const body = toCsv(rows);
  const filename = `sales-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
