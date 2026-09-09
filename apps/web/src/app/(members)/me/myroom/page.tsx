/**
 * /me/myroom — 2次元の ReiRieRoom (MyRoom)。
 *
 * 【非表示ゲート / 今回の主目的】
 * MyRoom は開発中のため「非公開・管理者のみ」で運用する。
 *
 *   一般会員 / 未ログイン … notFound() で 404 (機能の存在ごと隠す)
 *   管理者 (ADMIN 以上)  … プレビュー表示 (先頭に「非公開中」バナー)
 *
 * 403 ではなく 404 にしているのは、403 だと「そこに何かがある」と
 * 分かってしまい、公開前に話題が漏れる余地が残るため
 * (ゲームの /me/games/* と同じ判断に揃えている)。
 *
 * 【現在の実装範囲】
 * 部屋を «見る» ところまで。家具の購入・保存は次段階で、
 * この画面は管理者が配置の見た目を確認するためのプレビューとして機能する。
 * 配置はブラウザ内 (localStorage) に保持し、まだサーバーへ保存しない。
 * 保存を伴わないので、Pui を消費させる処理も入れていない
 * (未完成の状態で Pui を減らすと返金対応が発生するため)。
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import { MYROOM_GRID_SIZE } from '@idol/shared';
import { auth } from '@/auth';
import { resolveMyRoomVisibility } from '@/lib/myroom-visibility';
import { MyRoomPreviewBanner } from '@/components/myroom/MyRoomPreviewBanner';
import { MyRoomClient } from './myroom-client';

export const metadata: Metadata = { title: 'ReiRieRoom' };
export const dynamic = 'force-dynamic';

export default async function MyRoomPage() {
  // 非公開中は一般会員には 404。管理者だけプレビューできる。
  const { canView, isPreview } = await resolveMyRoomVisibility();
  if (!canView) notFound();

  const session = await auth();
  if (!session?.user) {
    redirect('/signin?callbackUrl=/me/myroom');
  }

  const [furnitures, user] = await Promise.all([
    prisma.myRoomFurniture.findMany({
      where: {
        status: 'PUBLISHED',
        // 画像のない家具は出さない (透明な家具を並べない)
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
      take: 300,
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pui: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {isPreview && <MyRoomPreviewBanner />}
      <MyRoomClient
        gridSize={MYROOM_GRID_SIZE}
        balance={user?.pui ?? 0}
        catalog={furnitures.map((f) => ({
          id: f.id,
          name: f.name,
          description: f.description,
          category: f.category,
          puiCost: f.puiCost,
          widthCells: f.widthCells,
          heightCells: f.heightCells,
          imageUrl: f.imageUrl ?? '',
        }))}
      />
    </div>
  );
}
