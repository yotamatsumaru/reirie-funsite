/**
 * PATCH /api/admin/videos/[id]
 *
 * 投稿済み動画のメタ情報（タイトル / 説明文 / 公開範囲 / 公開開始日時 / 配信期限 /
 * サムネイルURL）を編集する。
 *
 * ## なぜ必要か
 * アップロード時にファイル名から仮のタイトルを自動入力する導線があるため
 * （upload-form.tsx: `f.name.replace(/\.[^.]+$/, '')`）、後から直せないと
 * `20260702_FCビジュアルビハインド_REIRIE` のようなファイル名が
 * そのまま会員に見えてしまう。誤字の修正も再アップロードしかなくなる。
 *
 * ## 編集できる / できない項目の線引き
 * 可: title / description / accessLevel / publishedAt / expiresAt / thumbnailUrl
 *     → 運営が後から言い直せるべき「表示上の情報」。
 * 不可: s3SourceKey / s3HlsKey / status / durationSeconds / mediaConvertJob
 *     → S3 上の実体やエンコード結果と紐づく。DB だけ書き換えると
 *       実体と乖離して再生できなくなるため、意図的に受け付けない
 *       （zod の strict で未知キーを弾く）。
 *
 * ## thumbnailUrl をここで受ける理由と制限
 * サムネイルの主導線は画像アップロード
 * （POST /api/admin/videos/[id]/thumbnail、multipart）だが、
 * 外部CDNの画像を使いたい / アップロードが使えない環境向けに
 * 「URL 直接指定」も残している。ここはその URL 指定を受ける。
 *
 * 任意文字列をそのまま `<img src>` に流すと `javascript:` 等が入り得るため、
 * http(s) 限定に絞る（validateThumbnailUrlInput）。null は「サムネイルを外す」。
 * URL を指定した場合は DB 保存されていたバイト列（thumbnailData）も
 * 併せて消す。残しておくと容量を食うだけで、もう配信されないため。
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
import { validateThumbnailUrlInput, classifyThumbnailValue } from '@/lib/video-thumbnail';
import { deleteStoredThumbnailData } from '@/lib/video-thumbnail-store';

export const runtime = 'nodejs';

const PatchSchema = z
  .object({
    title: z.string().trim().min(1, 'タイトルを入力してください').max(VIDEO_TITLE_MAX).optional(),
    // null は「説明文を消す」の意思表示。undefined（キー自体なし）は「変更しない」。
    description: z.string().max(VIDEO_DESCRIPTION_MAX).nullable().optional(),
    accessLevel: z.enum(['PUBLIC', 'MEMBERS', 'PREMIUM']).optional(),
    // 公開開始日時。未来の日時を入れると「予約公開」になる
    // （一覧クエリが publishedAt <= now を条件にしているため、時刻が来るまで出ない）。
    // null は「公開開始日時なし」= 公開スイッチが ON でも一覧に出ない状態。
    publishedAt: z.iso.datetime().nullable().optional(),
    // null は「配信期限なし」
    expiresAt: z.iso.datetime().nullable().optional(),
    // null は「サムネイルを外す」。値は http(s) の絶対URL、または
    // アップロード API が返した内部パスのみ許す（後段で検証）。
    thumbnailUrl: z.string().nullable().optional(),
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

  // サムネイルURLは zod だけでは足りない（javascript: 等を弾く必要がある）ので
  // 専用の検証を通し、空文字列は null（=未設定）へ正規化する。
  let thumbnailUrl: string | null | undefined;
  if (data.thumbnailUrl !== undefined) {
    if (data.thumbnailUrl === null) {
      thumbnailUrl = null;
    } else {
      const check = validateThumbnailUrlInput(data.thumbnailUrl);
      if (!check.ok) throw errors.unprocessable(check.message);
      thumbnailUrl = check.value;
    }
  }

  // 公開開始が終了以降だと一度も表示されない動画になるので、保存前に弾く。
  // 部分更新なので、送られていない項目は既存値を使って判定する
  // （片方だけ直したときも矛盾を検知できるように）。
  const nextPublishedAt =
    data.publishedAt !== undefined
      ? data.publishedAt
        ? new Date(data.publishedAt)
        : null
      : existing.publishedAt;
  const nextExpiresAt =
    data.expiresAt !== undefined
      ? data.expiresAt
        ? new Date(data.expiresAt)
        : null
      : existing.expiresAt;
  if (nextPublishedAt && nextExpiresAt && nextPublishedAt >= nextExpiresAt) {
    throw errors.unprocessable(
      '公開開始日時は配信期限より前にしてください（このままでは動画が表示されません）',
    );
  }

  const updated = await prisma.video.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.accessLevel !== undefined ? { accessLevel: data.accessLevel } : {}),
      ...(data.publishedAt !== undefined
        ? { publishedAt: data.publishedAt ? new Date(data.publishedAt) : null }
        : {}),
      ...(data.expiresAt !== undefined
        ? { expiresAt: data.expiresAt ? new Date(data.expiresAt) : null }
        : {}),
      ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    },

    select: {
      id: true,
      title: true,
      description: true,
      accessLevel: true,
      publishedAt: true,
      expiresAt: true,
      isPublished: true,
      status: true,
      thumbnailUrl: true,
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
      ...(data.publishedAt !== undefined
        ? {
            publishedAt: {
              from: existing.publishedAt?.toISOString() ?? null,
              to: data.publishedAt ?? null,
            },
          }
        : {}),
      ...(data.expiresAt !== undefined
        ? {
            expiresAt: {
              from: existing.expiresAt?.toISOString() ?? null,
              to: data.expiresAt ?? null,
            },
          }
        : {}),
      ...(thumbnailUrl !== undefined
        ? {
            thumbnailUrl: { from: existing.thumbnailUrl ?? null, to: thumbnailUrl },
            thumbnailSource: 'url',
          }
        : {}),
    },
  });

  // URL 直接指定（または解除）に切り替えた場合、DB に保存されていた画像本体は
  // もう誰からも参照されないゴミになるので消す。
  // ただし「アップロード API が返した内部パスをそのまま送り返した」ケースは
  // 実体が今まさに参照されているので消してはいけない。
  if (
    thumbnailUrl !== undefined &&
    classifyThumbnailValue(thumbnailUrl ?? '') !== 'internal'
  ) {
    await deleteStoredThumbnailData(id);
  }

  // 公開範囲を厳しくした場合は、既存会員が見られなくなる点を伝える。
  const tightened =
    data.accessLevel !== undefined &&
    rank(data.accessLevel) > rank(existing.accessLevel);

  // 予約公開になった場合は「今は見えない」ことを明示する。
  // これを言わないと運営が「保存したのに会員側に出ない」と混乱する。
  const scheduled =
    data.publishedAt !== undefined && nextPublishedAt !== null && nextPublishedAt > new Date();

  return NextResponse.json({
    ok: true,
    video: updated,
    message: scheduled
      ? `保存しました。${formatJstForMessage(nextPublishedAt)} に公開予約されました（それまで会員側には表示されません）。`
      : tightened
        ? '保存しました。公開範囲を狭めたため、対象外のプランの会員には表示されなくなります。'
        : '保存しました',
  });
});

/** 管理者向けメッセージ用に日時を JST で読みやすく整形する */
function formatJstForMessage(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const iso = jst.toISOString();
  return `${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

/** 公開範囲の厳しさ（大きいほど限定的） */
function rank(level: string): number {
  if (level === 'PREMIUM') return 2;
  if (level === 'MEMBERS') return 1;
  return 0;
}
