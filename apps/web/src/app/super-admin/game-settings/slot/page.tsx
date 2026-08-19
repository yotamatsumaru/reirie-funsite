/**
 * /super-admin/game-settings/slot — スロット の設定
 *
 * 出玉設定 (1〜6) とサムネイル画像を集約するゲーム専用の設定ページ。
 * ゲームごとにページを分離している (インデックス: /super-admin/game-settings)。
 *
 * ※ スロットはキャラボイス / キャラクター画像を使わないため、それらの UI は載せていない
 *   (あっちむいてPUI のページと構成が違うのは意図的)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { gameThumbnailSlot, type SiteImageSlot } from '@idol/shared';
import { getSlotSettings } from '@/lib/app-setting';
import { listSiteImages } from '@/lib/site-image';
import { SlotSettingsClient } from '../slot-settings-client';
import {
  GameThumbnailClient,
  type GameThumbnailItem,
} from '../game-thumbnail-client';

export const metadata: Metadata = { title: 'スロット 設定 | Super Admin' };
export const dynamic = 'force-dynamic';

const THUMBNAIL_SLOT = gameThumbnailSlot('slot') as SiteImageSlot;

export default async function SlotGameSettingsPage() {
  const [slotSettings, siteImages] = await Promise.all([
    getSlotSettings(),
    listSiteImages(),
  ]);

  const thumb = siteImages.find((s) => s.slot === THUMBNAIL_SLOT);
  const thumbnailItem: GameThumbnailItem | null = thumb
    ? {
        slot: thumb.slot,
        url: thumb.url,
        fileName: thumb.fileName,
        sizeBytes: thumb.sizeBytes,
        updatedAt: thumb.updatedAt.toISOString(),
      }
    : null;

  return (
    <main>
      <header className="mb-5">
        <Link
          href="/super-admin/game-settings"
          className="text-xs font-semibold text-slate-500 hover:text-slate-700 hover:underline"
        >
          ← ゲーム設定一覧
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">スロット 設定</h1>
        <p className="mt-1 text-sm text-slate-500">
          出玉設定 (当選確率) とサムネイルの設定。売上・統計は「ゲーム経済」で確認できます。
        </p>
      </header>

      {/* ゲームサムネイル (ゲーム一覧カードの画像) */}
      <GameThumbnailClient slot={THUMBNAIL_SLOT} initial={thumbnailItem} />

      {/* 出玉設定 (1〜6) */}
      <SlotSettingsClient initial={slotSettings} />
    </main>
  );
}
