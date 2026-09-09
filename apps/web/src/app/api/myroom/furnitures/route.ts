/**
 * GET /api/myroom/furnitures — 会員向けの家具カタログ。
 *
 * 【非表示ゲート / 最重要】
 * MyRoom は現在「非公開・管理者のみ」で運用する。
 * ページを隠すだけでは不十分で、この API が誰でも叩ける状態だと
 * 家具の名前・価格・画像が公開前に取得できてしまう。
 * そのため requireMyRoomVisible で GET も塞ぐ (弾くときは 404)。
 *
 * 【並べる家具の条件】
 * status が PUBLISHED かつ画像がある家具だけを返す。
 * 画像のない家具を返すと «透明な家具» が並び、会員には
 * 何も見えないまま Pui を払わせることになる
 * (isMyRoomFurniturePurchasable の判断に合わせている)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { handle } from '@/lib/errors';
import { requireMyRoomVisible } from '@/lib/myroom-visibility';
import { MYROOM_GRID_SIZE } from '@idol/shared';

export const runtime = 'nodejs';

/** 一度に返す家具の上限 (家具が増えても応答が重くならないように) */
const CATALOG_LIMIT = 300;

export const GET = handle(async (req: Request) => {
  const { isPreview } = await requireMyRoomVisible(req);

  const furnitures = await prisma.myRoomFurniture.findMany({
    where: {
      status: 'PUBLISHED',
      // 画像のない家具は会員に出さない (透明な家具を買わせない)
      imageUrl: { not: null },
    },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      puiCost: true,
      widthCells: true,
      heightCells: true,
      imageUrl: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: CATALOG_LIMIT,
  });

  return NextResponse.json({
    furnitures,
    gridSize: MYROOM_GRID_SIZE,
    // 管理者プレビュー中であることをクライアントに伝える
    // (画面に「非公開中」バナーを出すため)
    isPreview,
  });
});
