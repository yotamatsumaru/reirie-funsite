/**
 * ゲーム音声 (あっち向いてホイのキャラボイス) の保存・取得ヘルパ。
 *
 * 保存方針は product-image.ts と同一 (本番 EC2 standalone + PM2 cluster 対応):
 *   1. S3 アセットバケットが設定済み → S3 へアップロードし url は外部URL、data は null。
 *   2. 未設定 → バイト列を DB (GameAudio.data) に保存し、
 *      /api/media/game-audio/{id} 経由で配信する。
 *
 * slot ごとに 1 件だけ保持する (再アップロード時は既存を置き換え)。
 */
import { prisma } from '@idol/db';
import crypto from 'node:crypto';
import {
  ACCHI_VOICE_SLOTS,
  type AcchiVoiceSlot,
  type AcchiVoiceUrlMap,
} from '@idol/shared';
import { isAssetStorageConfigured, putAsset } from './s3';

export type StoredGameAudio = {
  id: string;
  slot: AcchiVoiceSlot;
  url: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  updatedAt: Date;
  storage: 's3' | 'db';
};

/**
 * 指定スロットの音声を保存 (既存があれば置き換え)。
 */
export async function saveGameAudio(params: {
  slot: AcchiVoiceSlot;
  bytes: Buffer;
  contentType: string;
  ext: string;
  fileName: string | null;
}): Promise<StoredGameAudio> {
  const { slot, bytes, contentType, ext, fileName } = params;

  if (isAssetStorageConfigured()) {
    const key = `game-audio/${slot}-${crypto.randomUUID()}.${ext}`;
    const url = await putAsset(key, bytes, contentType);
    const row = await prisma.gameAudio.upsert({
      where: { slot },
      create: { slot, url, contentType, fileName, sizeBytes: bytes.byteLength, data: null },
      update: { url, contentType, fileName, sizeBytes: bytes.byteLength, data: null },
    });
    return { ...toStored(row), storage: 's3' };
  }

  // DB 保存フォールバック: 先に upsert して id を確定させ、url を id ベースにする。
  const base = await prisma.gameAudio.upsert({
    where: { slot },
    create: {
      slot,
      url: '',
      contentType,
      fileName,
      sizeBytes: bytes.byteLength,
      data: bytes,
    },
    update: {
      contentType,
      fileName,
      sizeBytes: bytes.byteLength,
      data: bytes,
    },
  });
  // キャッシュバスターに updatedAt を付ける (差し替え時にブラウザキャッシュを無効化)。
  const url = `/api/media/game-audio/${base.id}?v=${base.updatedAt.getTime()}`;
  const row = await prisma.gameAudio.update({ where: { id: base.id }, data: { url } });
  return { ...toStored(row), storage: 'db' };
}

/** 指定スロットの音声を削除。 */
export async function deleteGameAudio(slot: AcchiVoiceSlot): Promise<void> {
  await prisma.gameAudio.deleteMany({ where: { slot } });
}

/** 管理画面一覧用: 全スロットのメタ情報 (バイト列は含めない)。 */
export async function listGameAudio(): Promise<StoredGameAudio[]> {
  const rows = await prisma.gameAudio.findMany({
    where: { slot: { in: [...ACCHI_VOICE_SLOTS] } },
    select: {
      id: true,
      slot: true,
      url: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      updatedAt: true,
      data: true,
    },
  });
  return rows
    .filter((r): r is typeof r & { slot: AcchiVoiceSlot } =>
      (ACCHI_VOICE_SLOTS as readonly string[]).includes(r.slot),
    )
    .map((r) => ({
      id: r.id,
      slot: r.slot,
      url: r.url,
      fileName: r.fileName,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      updatedAt: r.updatedAt,
      storage: r.data ? 'db' : 's3',
    }));
}

/**
 * slot → URL のマップを返す (ゲームに渡す用)。
 * 設定されているスロットのみ含む。
 */
export async function getAcchiVoiceUrlMap(): Promise<AcchiVoiceUrlMap> {
  const rows = await prisma.gameAudio.findMany({
    where: { slot: { in: [...ACCHI_VOICE_SLOTS] } },
    select: { slot: true, url: true },
  });
  const map: AcchiVoiceUrlMap = {};
  for (const r of rows) {
    if ((ACCHI_VOICE_SLOTS as readonly string[]).includes(r.slot) && r.url) {
      map[r.slot as AcchiVoiceSlot] = r.url;
    }
  }
  return map;
}

function toStored(row: {
  id: string;
  slot: string;
  url: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  updatedAt: Date;
}): Omit<StoredGameAudio, 'storage'> {
  return {
    id: row.id,
    slot: row.slot as AcchiVoiceSlot,
    url: row.url,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    updatedAt: row.updatedAt,
  };
}
