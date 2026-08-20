/**
 * GET   /api/super-admin/game-visibility — ゲーム個別の公開設定を取得
 * PATCH /api/super-admin/game-visibility — ゲーム個別の公開設定を更新 (即時反映)
 *
 * SUPER_ADMIN 限定 (GET はスタッフも閲覧可)。値は AppSetting (game.visibility) に永続化する。
 *
 * 非公開にしたゲームは、そのゲームのページと API だけが一般ユーザーに 404 相当になる
 * (他のゲームは影響を受けない)。管理者 (ADMIN 以上) は非公開中もプレビューとして
 * プレイできる (開発中の動作確認のため)。
 *
 * ゲーム機能そのものを一括で止めたい場合は、従来どおり
 * /api/super-admin/site-visibility の gamesVisible (マスタースイッチ) を使う。
 */
import { NextResponse } from 'next/server';
import { GameVisibilityMapSchema, isGameKey, type GameVisibilityMap } from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  getGameVisibility,
  setGameVisibility,
  getSiteSectionVisibility,
} from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const [visibility, { gamesVisible }] = await Promise.all([
    getGameVisibility(),
    getSiteSectionVisibility(),
  ]);
  // マスタースイッチも併せて返す。UI 側で「マスターが OFF なので個別 ON でも
  // 公開されていない」ことを明示するために必要。
  return NextResponse.json({ visibility, gamesVisible });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = GameVisibilityMapSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です');
  }

  // 未知のゲームキーは受け付けない。タイポで存在しないゲームの設定が
  // 保存され「トグルしたのに変わらない」状態になるのを防ぐ。
  const patch: Partial<GameVisibilityMap> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!isGameKey(key)) {
      throw errors.unprocessable(`不明なゲームです: ${key}`);
    }
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) {
    throw errors.unprocessable('変更内容が指定されていません');
  }

  const { before, after } = await setGameVisibility(patch);

  await logAudit({
    userId: session.user.id,
    action: 'setting.game_visibility_update',
    resource: 'setting:game.visibility',
    metadata: { from: before, to: after },
  });

  const { gamesVisible } = await getSiteSectionVisibility();
  return NextResponse.json({ visibility: after, gamesVisible });
});
