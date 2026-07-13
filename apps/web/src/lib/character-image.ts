/**
 * あっち向いてホイ用キャラクター画像 (ポーズごとの差し替え可能画像) の保存・取得ヘルパ。
 *
 * 保存方針は game-audio.ts / site-image.ts と同一 (本番 EC2 standalone + PM2 cluster 対応):
 *   1. S3 アセットバケットが設定済み → S3 へアップロードし url は外部URL、data は null。
 *   2. 未設定 → バイト列を DB (CharacterImage.data) に保存し、
 *      /api/media/character-image/{id} 経由で配信する。
 *
 * slot (= ポーズ: idle/rock/scissors/paper/up/down/left/right) ごとに、
 * variant (1〜CHARACTER_IMAGE_VARIANTS_PER_SLOT) の複数パターンを保持できる。
 * 同一 (slot, variant) は 1 件だけ保持する (再アップロード時は既存を置き換え)。
 * ゲーム表示時は各ポーズの登録済みパターンからランダムに 1 枚が選ばれる。
 */
import { prisma } from '@idol/db';
import crypto from 'node:crypto';
import {
  CHARACTER_IMAGE_SLOTS,
  type CharacterImageSlot,
  type CharacterImageUrlMap,
} from '@idol/shared';
import { isAssetStorageConfigured, putAsset } from './s3';

export type StoredCharacterImage = {
  id: string;
  slot: CharacterImageSlot;
  variant: number;
  url: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  updatedAt: Date;
  storage: 's3' | 'db';
};

/**
 * 指定スロット (ポーズ) + パターン番号の画像を保存 (既存があれば置き換え)。
 */
export async function saveCharacterImage(params: {
  slot: CharacterImageSlot;
  variant: number;
  bytes: Buffer;
  contentType: string;
  ext: string;
  fileName: string | null;
}): Promise<StoredCharacterImage> {
  const { slot, variant, bytes, contentType, ext, fileName } = params;

  if (isAssetStorageConfigured()) {
    const key = `character-images/${slot}-${variant}-${crypto.randomUUID()}.${ext}`;
    const url = await putAsset(key, bytes, contentType);
    const row = await prisma.characterImage.upsert({
      where: { slot_variant: { slot, variant } },
      create: { slot, variant, url, contentType, fileName, sizeBytes: bytes.byteLength, data: null },
      update: { url, contentType, fileName, sizeBytes: bytes.byteLength, data: null },
    });
    return { ...toStored(row), storage: 's3' };
  }

  // DB 保存フォールバック: 先に upsert して id を確定させ、url を id ベースにする。
  const base = await prisma.characterImage.upsert({
    where: { slot_variant: { slot, variant } },
    create: {
      slot,
      variant,
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
  const url = `/api/media/character-image/${base.id}?v=${base.updatedAt.getTime()}`;
  const row = await prisma.characterImage.update({ where: { id: base.id }, data: { url } });
  return { ...toStored(row), storage: 'db' };
}

/** 指定スロット (ポーズ) + パターン番号の画像を削除。 */
export async function deleteCharacterImage(
  slot: CharacterImageSlot,
  variant: number,
): Promise<void> {
  await prisma.characterImage.deleteMany({ where: { slot, variant } });
}

/** 管理画面一覧用: 全スロット・全パターンのメタ情報 (バイト列は含めない)。 */
export async function listCharacterImages(): Promise<StoredCharacterImage[]> {
  const rows = await prisma.characterImage.findMany({
    where: { slot: { in: [...CHARACTER_IMAGE_SLOTS] } },
    select: {
      id: true,
      slot: true,
      variant: true,
      url: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      updatedAt: true,
      data: true,
    },
    orderBy: [{ slot: 'asc' }, { variant: 'asc' }],
  });
  return rows
    .filter((r): r is typeof r & { slot: CharacterImageSlot } =>
      (CHARACTER_IMAGE_SLOTS as readonly string[]).includes(r.slot),
    )
    .map((r) => ({
      id: r.id,
      slot: r.slot,
      variant: r.variant,
      url: r.url,
      fileName: r.fileName,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      updatedAt: r.updatedAt,
      storage: r.data ? 'db' : 's3',
    }));
}

/**
 * slot (ポーズ) → (パターン番号 → URL) のマップを返す (ゲーム画面に渡す用)。
 * 各ポーズに登録されているパターンを variant 番号をキーにしてまとめる。
 * ゲーム側 (CharacterAvatar) はプレイ開始時に選んだパターン番号を全ポーズで
 * 優先的に使う (統一感のため)。設定されているスロット/パターンのみ含む。
 */
export async function getCharacterImageUrlMap(): Promise<CharacterImageUrlMap> {
  const rows = await prisma.characterImage.findMany({
    where: { slot: { in: [...CHARACTER_IMAGE_SLOTS] } },
    select: { slot: true, variant: true, url: true },
    orderBy: [{ slot: 'asc' }, { variant: 'asc' }],
  });
  const map: CharacterImageUrlMap = {};
  for (const r of rows) {
    if ((CHARACTER_IMAGE_SLOTS as readonly string[]).includes(r.slot) && r.url) {
      const slot = r.slot as CharacterImageSlot;
      (map[slot] ??= {})[r.variant] = r.url;
    }
  }
  return map;
}

function toStored(row: {
  id: string;
  slot: string;
  variant: number;
  url: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  updatedAt: Date;
}): Omit<StoredCharacterImage, 'storage'> {
  return {
    id: row.id,
    slot: row.slot as CharacterImageSlot,
    variant: row.variant,
    url: row.url,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    updatedAt: row.updatedAt,
  };
}
