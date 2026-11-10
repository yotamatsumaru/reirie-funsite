/**
 * GET /api/me/mero — 自分の Mero (Pui の上位ポイント) 残高と直近の履歴
 *
 * 【非公開中】site.sectionVisibility.meroVisible が false の間は
 * 一般会員・未ログインには 404 を返す (機能の存在自体を隠す)。
 * 管理者 (ADMIN 以上) は動作確認のため閲覧でき、isPreview: true が返る。
 *
 * query: limit (1〜200, 既定 50)
 * response: { balance, transactions: [{ id, amount, balance, reason, note, createdAt }], isPreview }
 */
import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';
import { requireMeroVisible } from '@/lib/mero-visibility';
import { getMeroSummary } from '@/lib/mero';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  // 公開判定を先に行う (非公開中の一般会員には、ログイン有無に関わらず 404)
  const { isPreview } = await requireMeroVisible(req);
  const session = await requireApiSession(req);

  const limitRaw = Number(new URL(req.url).searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

  const { balance, transactions } = await getMeroSummary(session.user.id, limit);
  return NextResponse.json({ balance, transactions, isPreview });
});
