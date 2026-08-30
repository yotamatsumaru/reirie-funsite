/**
 * GET /api/super-admin/birthday/candidates?year=2026&q=検索語
 *   誕生日メールの「強制送信」対象を検索する (運営の救済操作用)。
 *
 * recipients エンドポイントとの違い:
 *   recipients : 「本日が誕生日 かつ 有料会員」しか返さない (自動送信の対象)。
 *   candidates : 条件で絞らず全会員から検索し、対象外の理由を添えて返す。
 *
 * 「誕生日を過ぎてしまった人」「無料会員」を運営が探して救済できるようにするため、
 * あえて条件を外している。誰が対象外なのかは ineligibleReasons で UI に伝える。
 *
 * 閲覧のみのため STAFF も可 (実際の送信は SUPER_ADMIN 限定)。
 */
import { NextResponse } from 'next/server';
import { BIRTHDAY_MAIL_YEAR_MIN, BIRTHDAY_MAIL_YEAR_MAX } from '@idol/shared';
import { requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { searchBirthdayMailCandidates } from '@/lib/birthday-mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  await requireSuperAdminView();
  const url = new URL(req.url);

  const year = Number(url.searchParams.get('year'));
  if (!Number.isInteger(year) || year < BIRTHDAY_MAIL_YEAR_MIN || year > BIRTHDAY_MAIL_YEAR_MAX) {
    throw errors.badRequest('年 (year) が不正です');
  }

  const q = (url.searchParams.get('q') ?? '').trim();
  // 空検索で全会員を返すと誤操作の温床になるため、明示的に空配列を返す。
  if (!q) {
    return NextResponse.json({ candidates: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const candidates = await searchBirthdayMailCandidates({ year, query: q, limit: 20 });

  return NextResponse.json({ candidates }, { headers: { 'Cache-Control': 'no-store' } });
});
