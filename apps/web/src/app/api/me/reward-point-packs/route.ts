/**
 * GET /api/me/reward-point-packs — 購入可能な Pui パック一覧 (会員向け)
 *
 * ## なぜ必要か
 *
 * 購入実行 API (POST /api/me/reward-points/purchase) は以前から存在するのに、
 * **一覧を取得する API が無かった**。Web 側 (/me/rewards/buy) は
 * Server Component が prisma を直接呼んでいたため成立していたが、
 * ネイティブアプリからは「何が買えるのか・いくらか」を取得できず、
 * 購入 API を呼ぶための packId も分からない状態だった。
 *
 * ## Web と同じ条件・同じ並び順にする
 *
 * where / orderBy / select は /me/rewards/buy と一致させている。
 * ここがズレると「アプリには出るのに Web には出ないパック」や
 * 「並び順が違って一番安いものが下に来る」といった差が生まれる。
 *
 *   - isActive: true      … 販売停止したパックを出さない
 *   - sortOrder → priceJpy … 運営が決めた並び、同順なら安い順
 *
 * ## 認証を必須にする理由
 *
 * 価格表自体は秘密ではないが、購入は会員のみが行う操作であり、
 * 未ログインで一覧だけ取れても次の購入 API で 401 になる。
 * 既存の景品カタログ API (/api/me/reward-catalog) も
 * requireApiSession を使っているので揃えている。
 *
 * response: { packs: [{ id, name, pui, priceJpy }] }
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  await requireApiSession(req);

  const packs = await prisma.rewardPointPack.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { priceJpy: 'asc' }],
    select: {
      id: true,
      name: true,
      pui: true,
      priceJpy: true,
    },
  });

  return NextResponse.json({ packs });
});
