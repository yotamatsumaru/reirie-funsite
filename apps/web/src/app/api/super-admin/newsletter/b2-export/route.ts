/**
 * GET /api/super-admin/newsletter/b2-export
 *   会報誌の発送先を ヤマト B2クラウド「送り状発行」取込CSV でダウンロードする。
 *
 * クエリ:
 *   cutoff      … 基準日 (YYYY-MM-DD, JST)。この日時点の年間会員 (PREMIUM・年額) が対象。必須
 *   invoiceType … 送り状種類 (0=発払い / 7=ネコポス / 8=宅急便コンパクト / 3=DM便)。既定 0
 *   itemName    … 品名 (既定「会報誌」)
 *
 * 対象は «発送連絡メール» と同じ (fetchAnnualMembersOn)。
 * そのため «送り状を作った人» と «発送しましたメールが届く人» が一致する。
 * 住所が揃っていない会員は送り状を作れないので含めない。
 *
 * 個人情報 (住所・電話) の持ち出しになるため、宛名 CSV と同じく監査ログに記録する。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { B2_INVOICE_TYPES, jstDayRange } from '@idol/shared';
import { requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { fetchAnnualMembersOn } from '@/lib/newsletter-mail';
import { buildNewsletterB2Csv } from '@/lib/newsletter-b2';

export const runtime = 'nodejs';

const INVOICE_CODES = B2_INVOICE_TYPES.map((t) => t.code) as [string, ...string[]];

const QuerySchema = z.object({
  cutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '基準日は YYYY-MM-DD 形式で指定してください'),
  invoiceType: z.enum(INVOICE_CODES).default('0'),
  itemName: z.string().trim().min(1).max(25).default('会報誌'),
});

export const GET = handle(async (req: Request) => {
  const session = await requireSuperAdminView();

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    cutoff: url.searchParams.get('cutoff') ?? undefined,
    invoiceType: url.searchParams.get('invoiceType') || undefined,
    itemName: url.searchParams.get('itemName') || undefined,
  });
  if (!parsed.success) {
    throw errors.badRequest(parsed.error.issues[0]?.message ?? '入力値が不正です');
  }
  const { cutoff, invoiceType, itemName } = parsed.data;
  const day = jstDayRange(cutoff);
  if (!day) throw errors.badRequest('存在しない日付です');

  const members = await fetchAnnualMembersOn(day);
  const result = buildNewsletterB2Csv(members, { itemName, invoiceType });

  await logAudit({
    userId: session.user.id,
    action: 'newsletter.b2_export',
    resource: 'users',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: {
      cutoff,
      invoiceType,
      itemName,
      annualMembers: members.length,
      exported: result.exported,
      skippedNeedsInfo: result.skippedNeedsInfo,
      missingPhone: result.missingPhone,
    },
  });

  const filename = `newsletter-yamato-b2-${cutoff}.csv`;
  return new NextResponse(result.csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      // 画面側で件数を出せるようにヘッダでも返す
      'X-Exported-Count': String(result.exported),
      'X-Skipped-Needs-Info': String(result.skippedNeedsInfo),
      'X-Missing-Phone': String(result.missingPhone),
    },
  });
});
