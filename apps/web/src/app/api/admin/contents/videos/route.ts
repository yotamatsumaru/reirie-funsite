/**
 * POST /api/admin/contents/videos
 *
 * ブログ記事本文に挿入する「短い動画」をアップロードし、挿入用の URL を返す。
 *
 * ## なぜ動画管理 (VOD) の入り口を使わないのか
 *
 * 既存の動画アップロード (POST /api/admin/videos) は MediaConvert による
 * HLS エンコードのパイプラインに乗せる作りで、
 *   - status=UPLOADING → READY になるまで記事に貼れない (待ちが長い)
 *   - 動画一覧 (/me/videos) に単独コンテンツとして並んでしまう
 *   - S3 / MediaConvert 未設定の環境では使えない
 * という前提だった。
 *
 * 本文クリップは「記事の一部」であって単独コンテンツではないので、
 * 本文画像 (POST /api/admin/contents/images) と全く同じ扱いに揃える。
 * すなわち CONTENT 権限で使え、保存先も S3 → DB の二段構えとする。
 *
 * form fields:
 *   file:     File   (必須, 動画)
 *   poster:   File   (任意, ポスター画像。ブラウザが最初のフレームから生成したもの)
 *   duration: string (任意, 秒。ブラウザが測った尺)
 *
 * response: { id, url, storage, posterUrl, warnings: string[] }
 */
import { NextResponse } from 'next/server';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  contentBodyVideoCompatibilityWarning,
  contentBodyVideoDurationWarning,
  validateContentBodyVideo,
} from '@/lib/content-body-video';
import { saveContentBodyVideo } from '@/lib/content-body-video-store';
import { validateContentBodyImage } from '@/lib/content-body-image';
import { saveContentBodyImage } from '@/lib/content-body-image-store';

export const runtime = 'nodejs';

/**
 * 動画本体は最大 32MB あるため、既定のボディ上限では受け取れない。
 * Route Handler は Next.js 側の bodyParser 制限を受けないが、
 * 大きなファイルを扱うことを明示しておく。
 */
export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('CONTENT');

  const form = await req.formData().catch(() => null);
  if (!form) throw errors.badRequest('multipart/form-data で送信してください');

  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('動画ファイル (file) が必要です');

  const check = validateContentBodyVideo({ contentType: file.type, sizeBytes: file.size });
  if (!check.ok) {
    if (check.error.kind === 'missing') {
      throw errors.badRequest('動画の形式を判別できませんでした。別のファイルをお試しください。');
    }
    throw errors.badRequest(check.error.message);
  }

  // 尺はブラウザ側の推定値。壊れていれば null にして先へ進む
  // (尺が測れないことを理由にアップロードを失敗させる価値はない)。
  const durationRaw = form.get('duration');
  const parsedDuration =
    typeof durationRaw === 'string' && durationRaw.trim() !== ''
      ? Number(durationRaw)
      : Number.NaN;
  const durationSeconds =
    Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : null;

  /**
   * ポスター画像。
   *
   * これが無いと、再生前の <video> が記事中に真っ黒の矩形として並ぶ。
   * ブラウザ側で最初のフレームを canvas に描いて JPEG にしたものを受け取る。
   *
   * 失敗しても動画本体のアップロードは続行する。
   * ポスターは「あると綺麗」なだけで、無くても再生はできるため、
   * ここで全体を失敗させるとユーザーの損失のほうが大きい。
   */
  let posterUrl: string | null = null;
  const poster = form.get('poster');
  if (poster instanceof File && poster.size > 0) {
    const posterCheck = validateContentBodyImage({
      contentType: poster.type,
      sizeBytes: poster.size,
    });
    if (posterCheck.ok) {
      try {
        const saved = await saveContentBodyImage({
          bytes: Buffer.from(await poster.arrayBuffer()),
          contentType: posterCheck.contentType,
          ext: posterCheck.ext,
          fileName: poster.name || null,
          uploadedBy: session.user.id,
        });
        posterUrl = saved.url;
      } catch (e) {
        // ポスターだけ落ちても本体は通す。原因追跡のためログには残す。
        console.warn('[content-body-video] poster upload failed', e);
      }
    }
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const saved = await saveContentBodyVideo({
    bytes,
    contentType: check.contentType,
    ext: check.ext,
    fileName: file.name || null,
    posterUrl,
    durationSeconds,
    uploadedBy: session.user.id,
  });

  // 弾きはしないが投稿者に伝えたいこと (再生互換性・尺の長さ)。
  const warnings = [
    contentBodyVideoCompatibilityWarning(check.contentType),
    durationSeconds !== null ? contentBodyVideoDurationWarning(durationSeconds) : null,
  ].filter((w): w is string => w !== null);

  await logAudit({
    userId: session.user.id,
    action: 'admin.content.video_uploaded',
    resource: `content-body-video:${saved.id}`,
    metadata: {
      contentType: check.contentType,
      size: bytes.byteLength,
      storage: saved.storage,
      fileName: file.name || null,
      durationSeconds,
      hasPoster: posterUrl !== null,
    },
  });

  return NextResponse.json({
    id: saved.id,
    url: saved.url,
    storage: saved.storage,
    posterUrl,
    warnings,
  });
});
