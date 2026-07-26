/**
 * GET /api/media/birthday-mail/[id]
 *  - DB に保存された誕生日メール画像のバイト列を配信する (S3 未設定時のフォールバック保存先)。
 *  - 誕生日メールの画像はメール内 (<img>) から参照されるため認証は不要
 *    (URL は uuid で推測困難。公開扱い)。
 *  - 保存方針は site-image と同一。差し替え時は url に ?v=<updatedAt> が付くため
 *    ブラウザ / メールクライアントのキャッシュは自然に更新される。
 */
import { prisma } from '@idol/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  const tpl = await prisma.birthdayMailTemplate.findUnique({
    where: { id },
    select: { imageData: true, imageContentType: true },
  });

  if (!tpl || !tpl.imageData) {
    return new Response('Not Found', { status: 404 });
  }

  const body = Buffer.isBuffer(tpl.imageData)
    ? tpl.imageData
    : Buffer.from(tpl.imageData);

  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': tpl.imageContentType ?? 'image/jpeg',
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
