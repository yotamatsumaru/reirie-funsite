/**
 * サイト内の差し替え可能画像 (トップページのヒーロー画像等) の保存・取得ヘルパ。
 *
 * 保存方針は game-audio.ts / product-image.ts と同一 (本番 EC2 standalone + PM2 cluster 対応):
 *   1. S3 アセットバケットが設定済み → S3 へアップロードし url は外部URL、data は null。
 *   2. 未設定 → バイト列を DB (SiteImage.data) に保存し、
 *      /api/media/site-image/{id} 経由で配信する。
 *
 * slot ごとに 1 件だけ保持する (再アップロード時は既存を置き換え)。
 */
import { prisma } from '@idol/db';
import crypto from 'node:crypto';
import {
  SITE_IMAGE_SLOTS,
  type SiteImageSlot,
  type SiteImageUrlMap,
} from '@idol/shared';
import { isAssetStorageConfigured, putAsset } from './s3';

export type StoredSiteImage = {
  id: string;
  slot: SiteImageSlot;
  url: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  updatedAt: Date;
  storage: 's3' | 'db';
};

/**
 * 指定スロットの画像を保存 (既存があれば置き換え)。
 */
export async function saveSiteImage(params: {
  slot: SiteImageSlot;
  bytes: Buffer;
  contentType: string;
  ext: string;
  fileName: string | null;
}): Promise<StoredSiteImage> {
  const { slot, bytes, contentType, ext, fileName } = params;

  if (isAssetStorageConfigured()) {
    const key = `site-images/${slot}-${crypto.randomUUID()}.${ext}`;
    const url = await putAsset(key, bytes, contentType);
    const row = await prisma.siteImage.upsert({
      where: { slot },
      create: { slot, url, contentType, fileName, sizeBytes: bytes.byteLength, data: null },
      update: { url, contentType, fileName, sizeBytes: bytes.byteLength, data: null },
    });
    return { ...toStored(row), storage: 's3' };
  }

  // DB 保存フォールバック: 先に upsert して id を確定させ、url を id ベースにする。
  const base = await prisma.siteImage.upsert({
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
  const url = `/api/media/site-image/${base.id}?v=${base.updatedAt.getTime()}`;
  const row = await prisma.siteImage.update({ where: { id: base.id }, data: { url } });
  return { ...toStored(row), storage: 'db' };
}

/** 指定スロットの画像を削除。 */
export async function deleteSiteImage(slot: SiteImageSlot): Promise<void> {
  await prisma.siteImage.deleteMany({ where: { slot } });
}

/** 管理画面一覧用: 全スロットのメタ情報 (バイト列は含めない)。 */
export async function listSiteImages(): Promise<StoredSiteImage[]> {
  const rows = await prisma.siteImage.findMany({
    where: { slot: { in: [...SITE_IMAGE_SLOTS] } },
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
    .filter((r): r is typeof r & { slot: SiteImageSlot } =>
      (SITE_IMAGE_SLOTS as readonly string[]).includes(r.slot),
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
 * slot → URL のマップを返す (表示側に渡す用)。
 * 設定されているスロットのみ含む。
 */
export async function getSiteImageUrlMap(): Promise<SiteImageUrlMap> {
  const rows = await prisma.siteImage.findMany({
    where: { slot: { in: [...SITE_IMAGE_SLOTS] } },
    select: { slot: true, url: true },
  });
  const map: SiteImageUrlMap = {};
  for (const r of rows) {
    if ((SITE_IMAGE_SLOTS as readonly string[]).includes(r.slot) && r.url) {
      map[r.slot as SiteImageSlot] = r.url;
    }
  }
  return map;
}

/** 指定スロットの画像 URL を1件取得 (未設定なら null)。 */
export async function getSiteImageUrl(slot: SiteImageSlot): Promise<string | null> {
  const row = await prisma.siteImage.findUnique({ where: { slot }, select: { url: true } });
  return row?.url ?? null;
}

function toStored(row: {
  id: string;
  slot: string;
  url: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  updatedAt: Date;
}): Omit<StoredSiteImage, 'storage'> {
  return {
    id: row.id,
    slot: row.slot as SiteImageSlot,
    url: row.url,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    updatedAt: row.updatedAt,
  };
}
