/**
 * GET  /api/contents/comments?contentId=...&page=1&limit=20
 *   - 記事のコメント一覧 (誰でも閲覧可)
 *
 * POST /api/contents/comments
 *   - コメント投稿 (STANDARD 以上限定)
 *   - body: { contentId, body }
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import {
  CreateContentCommentSchema,
  ListContentCommentsQuerySchema,
  CAN_POST_COMMENT,
  canAccess,
} from '@idol/shared';
import { requireApiAccessLevel, resolveApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { sanitizeContentBody } from '@/lib/sanitize-html';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const query = ListContentCommentsQuerySchema.parse({
    contentId: url.searchParams.get('contentId'),
    page: url.searchParams.get('page') ?? 1,
    limit: url.searchParams.get('limit') ?? 20,
  });

  // 公開記事のみコメントを返す。閲覧時のプラン要件は記事側 (canAccess) でチェック
  const content = await prisma.content.findUnique({
    where: { id: query.contentId },
    select: { id: true, status: true, accessLevel: true },
  });
  if (!content || content.status !== 'PUBLISHED') {
    throw errors.notFound('記事が見つかりません');
  }

  // 会員限定記事のコメント閲覧にはプラン要件を適用
  const session = await resolveApiSession(req);
  if (!canAccess(session?.user?.plan, content.accessLevel)) {
    throw errors.planRequired(content.accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }

  const [items, total] = await Promise.all([
    prisma.contentComment.findMany({
      where: { contentId: query.contentId },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    }),
    prisma.contentComment.count({ where: { contentId: query.contentId } }),
  ]);

  // 自分が投稿できるか (UI のフォーム表示判定用)
  const myPlan = session?.user?.plan ?? 'FREE';
  const canPost = CAN_POST_COMMENT[myPlan];

  return NextResponse.json({
    items: items.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      user: {
        id: c.user.id,
        displayName: c.user.displayName,
        avatarUrl: c.user.avatarUrl,
      },
    })),
    page: query.page,
    limit: query.limit,
    total,
    hasMore: query.page * query.limit < total,
    canPost,
    plan: myPlan,
  });
});

export const POST = handle(async (req: Request) => {
  // STANDARD 以上のみ投稿可能
  const session = await requireApiAccessLevel(req, 'MEMBERS');
  if (!session?.user?.id) throw errors.unauthorized();

  const input = CreateContentCommentSchema.parse(await req.json());

  const content = await prisma.content.findUnique({
    where: { id: input.contentId },
    select: { id: true, status: true, accessLevel: true },
  });
  if (!content || content.status !== 'PUBLISHED') {
    throw errors.notFound('記事が見つかりません');
  }
  // プレミアム限定記事へのコメント投稿は PREMIUM 必須
  if (!canAccess(session.user.plan, content.accessLevel)) {
    throw errors.planRequired(content.accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }

  const comment = await prisma.contentComment.create({
    data: {
      contentId: input.contentId,
      userId: session.user.id,
      // 現状フロントは React の自動エスケープ経由でしか body を表示していないが、
      // 将来 dangerouslySetInnerHTML 等で表示する実装が追加された場合に備え、
      // 保存前に HTML をサニタイズする (defense-in-depth)。
      body: sanitizeContentBody(input.body),
    },
    include: {
      user: { select: { id: true, displayName: true, avatarUrl: true } },
    },
  });

  return NextResponse.json(
    {
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      user: {
        id: comment.user.id,
        displayName: comment.user.displayName,
        avatarUrl: comment.user.avatarUrl,
      },
    },
    { status: 201 },
  );
});
