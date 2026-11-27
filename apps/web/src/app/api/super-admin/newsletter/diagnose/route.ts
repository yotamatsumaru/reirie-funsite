/**
 * GET /api/super-admin/newsletter/diagnose?memberNumber=RR-000698&cutoff=2026-08-15
 *
 * 会報誌が「届いていない」と問い合わせがあったときの個別確認。
 * 基準日時点の年間会員か (理由つき)・住所の不足・過去にダウンロードした発送用 CSV に入っていたか、を返す。
 *
 * 閲覧のみ (書き込みなし) なので SUPER_ADMIN / STAFF が使える。
 * 個人情報を参照するため監査ログに記録する。
 */
import { NextResponse } from 'next/server';
import { jstDayRange } from '@idol/shared';
import { requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { diagnoseNewsletterMember, normalizeMemberNumberInput } from '@/lib/newsletter-diagnose';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireSuperAdminView();
  const url = new URL(req.url);
  const memberNumber = normalizeMemberNumberInput(url.searchParams.get('memberNumber') ?? '');
  if (!memberNumber) throw errors.badRequest('会員番号を RR-000123 の形式で入力してください');
  const cutoff = url.searchParams.get('cutoff') ?? '';
  const day = jstDayRange(cutoff);
  if (!day) throw errors.badRequest('基準日を YYYY-MM-DD 形式で指定してください');

  const result = await diagnoseNewsletterMember(memberNumber, day);

  await logAudit({
    userId: session.user.id,
    action: 'newsletter.diagnose',
    resource: 'users',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: { memberNumber, cutoff, found: result.found },
  });

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
});
