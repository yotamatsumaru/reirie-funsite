/**
 * GET    /api/super-admin/game-audio — あっち向いてホイのボイス一覧 (スロット別) を取得
 * POST   /api/super-admin/game-audio — ボイスファイルをアップロード (multipart/form-data)
 * DELETE /api/super-admin/game-audio — 指定スロットのボイスを削除
 *
 * SUPER_ADMIN 限定。保存は S3 (設定時) または DB (フォールバック)。
 *
 * form fields (POST):
 *   slot: string (必須, ACCHI_VOICE_SLOTS のいずれか)
 *   file: File   (必須, 音声)
 *
 * query/body (DELETE):
 *   ?slot=... または JSON { slot }
 */
import { NextResponse } from 'next/server';
import {
  ALLOWED_AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  isAcchiVoiceSlot,
} from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  listGameAudio,
  saveGameAudio,
  deleteGameAudio,
} from '@/lib/game-audio';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdmin();
  const items = await listGameAudio();
  return NextResponse.json({ items });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const form = await req.formData().catch(() => null);
  if (!form) throw errors.badRequest('multipart/form-data で送信してください');

  const slot = form.get('slot');
  if (typeof slot !== 'string' || !isAcchiVoiceSlot(slot)) {
    throw errors.badRequest('スロット (slot) が不正です');
  }

  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('音声ファイル (file) が必要です');

  const ext = ALLOWED_AUDIO_TYPES[file.type];
  if (!ext) {
    throw errors.badRequest(
      '対応していない音声形式です (mp3 / wav / ogg / m4a / aac / webm)',
    );
  }
  if (file.size > MAX_AUDIO_BYTES) {
    throw errors.badRequest('音声サイズは 5MB 以内にしてください');
  }
  if (file.size === 0) {
    throw errors.badRequest('空のファイルです');
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileName = typeof file.name === 'string' && file.name.trim() !== '' ? file.name : null;

  const stored = await saveGameAudio({
    slot,
    bytes,
    contentType: file.type,
    ext,
    fileName,
  });

  await logAudit({
    userId: session.user.id,
    action: 'setting.game_audio_upload',
    resource: `game-audio:${slot}`,
    metadata: { slot, storage: stored.storage, size: file.size, contentType: file.type },
  });

  return NextResponse.json({ ok: true, item: stored }, { status: 201 });
});

export const DELETE = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const url = new URL(req.url);
  let slot = url.searchParams.get('slot');
  if (!slot) {
    const body = await req.json().catch(() => null);
    if (body && typeof body.slot === 'string') slot = body.slot;
  }
  if (!slot || !isAcchiVoiceSlot(slot)) {
    throw errors.badRequest('スロット (slot) が不正です');
  }

  await deleteGameAudio(slot);

  await logAudit({
    userId: session.user.id,
    action: 'setting.game_audio_delete',
    resource: `game-audio:${slot}`,
    metadata: { slot },
  });

  return NextResponse.json({ ok: true });
});
