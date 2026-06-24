/**
 * POST /api/admin/videos/upload-url
 *  - 動画アップロード用の S3 PUT 署名URLを発行
 *  - クライアントはこの URL に直接 PUT して、その後 /api/admin/videos に s3SourceKey を送る
 */
import { NextResponse } from 'next/server';
import { PresignVideoUploadSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { handle } from '@/lib/errors';
import { presignVideoUpload } from '@/lib/s3';
import { logAudit } from '@/lib/audit';
import crypto from 'node:crypto';

export const runtime = 'nodejs';

function safeFilename(name: string): string {
  return name
    .replace(/[^\w.\-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('CONTENT');
  const body = PresignVideoUploadSchema.parse(await req.json());

  const id = crypto.randomUUID();
  const safe = safeFilename(body.filename);
  // 例: source/2026/05/<uuid>/<filename>
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const key = `source/${yyyy}/${mm}/${id}/${safe}`;

  const url = await presignVideoUpload(key, body.contentType);

  await logAudit({
    userId: session.user.id,
    action: 'admin.video.upload_url_issued',
    resource: `s3:${key}`,
    metadata: { filename: safe, contentType: body.contentType },
  });

  return NextResponse.json({
    uploadUrl: url,
    s3SourceKey: key,
    expiresIn: 3600,
  });
});
