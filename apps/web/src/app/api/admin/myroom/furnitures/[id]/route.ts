/**
 * PATCH  /api/admin/myroom/furnitures/[id] — 家具マスタの更新（部分更新）
 * DELETE /api/admin/myroom/furnitures/[id] — 家具マスタの削除
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { MyRoomFurniturePatchSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const FURNITURE_SELECT = {
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
  contentType: true,
  fileName: true,
  sizeBytes: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** UUID 以外の id で DB を叩かないための軽い門番 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireCapability('CONTENT');
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) throw errors.notFound('家具が見つかりません');

  /**
   * 【部分更新について】
   * MyRoomFurniturePatchSchema は `.partial()` なので「送られたフィールドだけ」が
   * 入る。スキーマ側に .default() を付けていないため、送っていないフィールドは
   * undefined のまま = Prisma が無視する = 既存値が維持される。
   * (.default() があると「Pui だけ変えたら名前が空に戻る」事故になる。
   *  packages/shared/src/myroom-furniture.ts のコメント参照)
   */
  const patch = MyRoomFurniturePatchSchema.parse(await req.json());

  const before = await prisma.myRoomFurniture.findUnique({
    where: { id },
    select: { id: true, name: true, status: true, imageUrl: true, puiCost: true },
  });
  if (!before) throw errors.notFound('家具が見つかりません');

  /**
   * 画像のない家具を「販売中」にしようとした場合は弾く。
   *
   * 会員から見ると「何も表示されない家具」が並ぶことになり、しかも
   * 管理画面の一覧では名前があるので気づきにくい。保存の時点で止めるのが
   * いちばん親切。（既に PUBLISHED で画像がある家具の画像を後から
   * 消す経路は用意していないので、ここだけ見れば十分）
   */
  if (patch.status === 'PUBLISHED' && !before.imageUrl) {
    throw errors.badRequest(
      '画像が未設定のため販売中にできません。先に家具の画像を登録してください。',
    );
  }

  const updated = await prisma.myRoomFurniture.update({
    where: { id },
    data: patch,
    select: FURNITURE_SELECT,
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.myroom.furniture_updated',
    resource: `myroom-furniture:${id}`,
    // 「何を変えたか」が後から追えるように、変更されたキーと
    // 状態・価格の前後だけ残す（差分全体は入力値が大きくなりうるので入れない）。
    metadata: {
      changedKeys: Object.keys(patch),
      statusBefore: before.status,
      statusAfter: updated.status,
      puiCostBefore: before.puiCost,
      puiCostAfter: updated.puiCost,
    },
  });

  return NextResponse.json({ furniture: updated });
});

export const DELETE = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireCapability('CONTENT');
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) throw errors.notFound('家具が見つかりません');

  const target = await prisma.myRoomFurniture.findUnique({
    where: { id },
    select: { id: true, name: true, status: true },
  });
  if (!target) throw errors.notFound('家具が見つかりません');

  /**
   * 【物理削除にしている理由】
   * まだ会員が家具を購入する機能 (PR2) がないため、削除しても
   * 誰の部屋も壊れない。この段階では「間違えて作った家具を消す」用途しかない。
   *
   * PR2 で購入履歴が入ったあとは、購入実績のある家具の削除を禁止し
   * (ARCHIVED を使わせる) 参照整合性を守る必要がある。そのための状態として
   * ARCHIVED を最初から用意してある。
   */
  await prisma.myRoomFurniture.delete({ where: { id } });

  await logAudit({
    userId: session.user.id,
    action: 'admin.myroom.furniture_deleted',
    resource: `myroom-furniture:${id}`,
    metadata: { name: target.name, status: target.status },
  });

  return NextResponse.json({ ok: true });
});
