/**
 * 管理画面: MyRoom の家具マスタ管理 (/admin/myroom/furnitures)
 *
 * 運営が「会員の部屋に置ける家具」を追加・編集・削除する画面。
 *
 * 【この画面と会員向け機能の関係】
 * MyRoom は 3 段階で開発する。
 *   1. 家具マスタ管理 (この画面)
 *   2. 部屋の編集・保存 + Pui での購入
 *   3. 他の会員の部屋の公開 + 通報 / モデレーション
 *
 * 会員向けの MyRoom は既定で非公開 (site.sectionVisibility.myRoomVisible = false)。
 * この管理画面は公開設定とは無関係に、CONTENT 権限があれば常に使える
 * (非公開のうちに家具を仕込んでおけるようにするため)。
 */
import type { Metadata } from 'next';
import { prisma } from '@idol/db';
import { requireCapabilityPage } from '@/auth';
import { getSiteSectionVisibility } from '@/lib/app-setting';
import { FurnitureManagerClient } from './furniture-manager-client';

export const metadata: Metadata = { title: 'MyRoom 家具管理' };
export const dynamic = 'force-dynamic';

export default async function AdminMyRoomFurnituresPage() {
  await requireCapabilityPage('CONTENT');

  const [furnitures, visibility] = await Promise.all([
    prisma.myRoomFurniture.findMany({
      // 準備中を先に。運営が「作業が残っている家具」を見落とさないように。
      orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        status: true,
        puiCost: true,
        widthCells: true,
        heightCells: true,
        sortOrder: true,
        imageUrl: true,
        sizeBytes: true,
        updatedAt: true,
      },
    }),
    getSiteSectionVisibility(),
  ]);

  return (
    <FurnitureManagerClient
      initialFurnitures={furnitures.map((f) => ({
        ...f,
        // Date はクライアントコンポーネントへ渡す際に文字列化する
        // (シリアライズ境界での型ズレを避けるため)。
        updatedAt: f.updatedAt.toISOString(),
      }))}
      myRoomVisible={visibility.myRoomVisible}
    />
  );
}
