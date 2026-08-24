/**
 * PATCH /api/admin/videos/[id]/visibility
 *
 * 動画 1 本ごとの公開 / 非公開を切り替える。
 *
 * ## status(READY) と分けている理由
 * `status` は「エンコードが終わったか」を表すもので、運営の意思
 * (見せる / 見せない) とは別軸。status を書き換えて非公開を表現すると
 * 再エンコード判定や完了通知の処理と衝突するため、公開制御専用の
 * `isPublished` を切り替える。
 *
 * 非公開にすると:
 *   - 会員向け一覧 (/contents, /me/videos) から消える
 *   - 詳細ページは 404
 *   - /api/videos/[id]/playback も 404 (署名付き URL を発行しない)
 * 既に発行済みの署名付き URL は CloudFront の有効期限まで残る点に注意
 * (即時遮断が必要な場合は CloudFront 側の無効化が必要)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { z } from 'zod';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const BodySchema = z.object({
  isPublished: z.boolean(),
});

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireCapability('CONTENT');
  const { id } = await ctx.params;
  const body = BodySchema.parse(await req.json().catch(() => ({})));

  const existing = await prisma.video.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('動画が見つかりません');

  // 公開に切り替える場合、エンコードが終わっていないと会員側では見えないため警告を返す。
  // (公開フラグ自体は立てておき、READY になった時点で自動的に見えるようにする)
  const notReady = body.isPublished && existing.status !== 'READY';

  const updated = await prisma.video.update({
    where: { id },
    data: {
      isPublished: body.isPublished,
      // 公開にする際に publishedAt が未設定なら埋める
      // (一覧クエリが publishedAt <= now を条件にしているため)
      ...(body.isPublished && !existing.publishedAt ? { publishedAt: new Date() } : {}),
    },
    select: { id: true, isPublished: true, status: true, publishedAt: true },
  });

  await logAudit({
    userId: session.user.id,
    action: body.isPublished ? 'admin.video.visibility_public' : 'admin.video.visibility_private',
    resource: `video:${id}`,
  });

  return NextResponse.json({
    ...updated,
    message: notReady
      ? '公開に設定しました。ただしエンコードが未完了のため、完了後に会員へ表示されます。'
      : body.isPublished
        ? '公開しました'
        : '非公開にしました',
  });
});
