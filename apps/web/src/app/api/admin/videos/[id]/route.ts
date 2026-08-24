/**
 * PATCH /api/admin/videos/[id]
 *
 * 投稿済み動画のメタ情報（タイトル / 説明文 / 公開範囲 / 配信期限）を編集する。
 *
 * ## なぜ必要か
 * アップロード時にファイル名から仮のタイトルを自動入力する導線があるため
 * （upload-form.tsx: `f.name.replace(/\.[^.]+$/, '')`）、後から直せないと
 * `20260702_FCビジュアルビハインド_REIRIE` のようなファイル名が
 * そのまま会員に見えてしまう。誤字の修正も再アップロードしかなくなる。
 *
 * ## 編集できる / できない項目の線引き
 * 可: title / description / accessLevel / expiresAt
 *     → 運営が後から言い直せるべき「表示上の情報」。
 * 不可: s3SourceKey / s3HlsKey / status / durationSeconds / mediaConvertJob
 *     → S3 上の実体やエンコード結果と紐づく。DB だけ書き換えると
 *       実体と乖離して再生できなくなるため、意図的に受け付けない
 *       （zod の strict で未知キーを弾く）。
 *
 * ## isPublished を扱わない理由
 * 公開 / 非公開は visibility 専用 API に分けている。ここに混ぜると
 * 「タイトルを直して保存したら意図せず公開状態が変わった」という事故が起きる。
 *
 * ## 部分更新にしている理由
 * 触っていない項目を送らせないことで、
 *   - 監査ログに「実際に何を直したか」だけが残る
 *   - 同時編集時に他人の変更を巻き戻さない
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { VIDEO_TITLE_MAX, VIDEO_DESCRIPTION_MAX } from '@/lib/video-edit';

export const runtime = 'nodejs';

const PatchSchema = z
  .object({
    title: z.string().trim().min(1, 'タイトルを入力してください').max(VIDEO_TITLE_MAX).optional(),
    // null は「説明文を消す」の意思表示。undefined（キー自体なし）は「変更しない」。
    description: z.string().max(VIDEO_DESCRIPTION_MAX).nullable().optional(),
    accessLevel: z.enum(['PUBLIC', 'MEMBERS', 'PREMIUM']).optional(),
    // null は「配信期限なし」
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  // 実体と紐づくカラム（s3HlsKey / status など）を誤って渡せないよう未知キーを拒否する。
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: '更新する項目が指定されていません',
  });

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireCapability('CONTENT');
  const { id } = await ctx.params;

  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const existing = await prisma.video.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('動画が見つかりません');

  const data = parsed.data;

  const updated = await prisma.video.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.accessLevel !== undefined ? { accessLevel: data.accessLevel } : {}),
      ...(data.expiresAt !== undefined
        ? { expiresAt: data.expiresAt ? new Date(data.expiresAt) : null }
        : {}),
    },
    select: {
      id: true,
      title: true,
      description: true,
      accessLevel: true,
      expiresAt: true,
      isPublished: true,
      status: true,
    },
  });

  // 監査ログには変更前後を残す。誰が何をどう直したかを後から追えるようにする
  // （長文の説明文をそのまま入れるとログが膨らむので長さのみ記録）。
  await logAudit({
    userId: session.user.id,
    action: 'admin.video.update',
    resource: `video:${id}`,
    metadata: {
      changedFields: Object.keys(data),
      ...(data.title !== undefined ? { title: { from: existing.title, to: data.title } } : {}),
      ...(data.description !== undefined
        ? {
            descriptionLength: {
              from: existing.description?.length ?? 0,
              to: data.description?.length ?? 0,
            },
          }
        : {}),
      ...(data.accessLevel !== undefined
        ? { accessLevel: { from: existing.accessLevel, to: data.accessLevel } }
        : {}),
      ...(data.expiresAt !== undefined
        ? {
            expiresAt: {
              from: existing.expiresAt?.toISOString() ?? null,
              to: data.expiresAt ?? null,
            },
          }
        : {}),
    },
  });

  // 公開範囲を厳しくした場合は、既存会員が見られなくなる点を伝える。
  const tightened =
    data.accessLevel !== undefined &&
    rank(data.accessLevel) > rank(existing.accessLevel);

  return NextResponse.json({
    ok: true,
    video: updated,
    message: tightened
      ? '保存しました。公開範囲を狭めたため、対象外のプランの会員には表示されなくなります。'
      : '保存しました',
  });
});

/** 公開範囲の厳しさ（大きいほど限定的） */
function rank(level: string): number {
  if (level === 'PREMIUM') return 2;
  if (level === 'MEMBERS') return 1;
  return 0;
}
