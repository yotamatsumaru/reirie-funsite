/**
 * GET /api/game/characters
 *   - 公開済キャラクター一覧 (sortOrder 順)
 *   - 認証不要 (LP / 一覧画面で使用)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { handle } from '@/lib/errors';
import { requireGameVisible } from '@/lib/game-visibility';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  // ゲーム非公開中は 404 (管理者のみ動作確認のため利用可)。
  // この API は認証不要なので、塗ぐことで未公開キャラの名前が外部に漏れないようにする。
  await requireGameVisible(req, 'story');
  const items = await prisma.gameCharacter.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      furigana: true,
      catchcopy: true,
      portraitUrl: true,
      themeColor: true,
      isPremiumOnly: true,
      affinityMax: true,
    },
  });
  return NextResponse.json({ items });
});
