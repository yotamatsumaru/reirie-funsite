/**
 * /super-admin/game-settings/acchi — あっちむいてPUI の設定
 *
 * 勝率 / キャラボイス / キャラクター画像 / サムネイル を集約する
 * ゲーム専用の設定ページ。ゲームごとにページを分離している (インデックス: /super-admin/game-settings)。
 *
 * 【2026-07 統合】以前あった「勝利特典ポイントボーナス設定」(AcchiRewardBonusClient) は、
 * Fan ポイント 1 種類への統合に伴い削除した。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { gameThumbnailSlot, type SiteImageSlot } from '@idol/shared';
import { getAcchiWinSettings } from '@/lib/app-setting';
import { listGameAudio } from '@/lib/game-audio';
import { listCharacterImages } from '@/lib/character-image';
import { listSiteImages } from '@/lib/site-image';
import { AcchiSettingsClient } from '../acchi-settings-client';
import { GameAudioClient, type GameAudioItem } from '../game-audio-client';
import { SuperAdminWriteGate } from '@/components/admin/SuperAdminReadOnly';
import {
  CharacterImageClient,
  type CharacterImageItem,
} from '../character-image-client';
import {
  GameThumbnailClient,
  type GameThumbnailItem,
} from '../game-thumbnail-client';

export const metadata: Metadata = { title: 'あっちむいてPUI 設定 | Super Admin' };
export const dynamic = 'force-dynamic';

const THUMBNAIL_SLOT = gameThumbnailSlot('acchi') as SiteImageSlot;

export default async function AcchiGameSettingsPage() {
  const [acchiSettings, gameAudio, characterImages, siteImages] = await Promise.all([
    getAcchiWinSettings(),
    listGameAudio(),
    listCharacterImages(),
    listSiteImages(),
  ]);

  const gameAudioItems: GameAudioItem[] = gameAudio.map((a: (typeof gameAudio)[number]) => ({
    slot: a.slot,
    url: a.url,
    fileName: a.fileName,
    sizeBytes: a.sizeBytes,
    updatedAt: a.updatedAt.toISOString(),
  }));
  const characterImageItems: CharacterImageItem[] = characterImages.map((a: (typeof characterImages)[number]) => ({
    slot: a.slot,
    variant: a.variant,
    url: a.url,
    fileName: a.fileName,
    sizeBytes: a.sizeBytes,
    updatedAt: a.updatedAt.toISOString(),
  }));

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
        <h1 className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">
          あっちむいてPUI 設定
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          勝率・キャラボイス・キャラクター画像・サムネイルの設定。
          売上・統計は「ゲーム経済」で確認できます。
        </p>
      </header>

      {/* ゲームサムネイル (ゲーム一覧カードの画像) */}
      <SuperAdminWriteGate silent>
        <GameThumbnailClient slot={THUMBNAIL_SLOT} initial={thumbnailItem} />
      </SuperAdminWriteGate>

      {/* 勝率設定 */}
      <SuperAdminWriteGate label="ゲーム設定の変更はスーパー管理者のみ実行できます">
        <AcchiSettingsClient initial={acchiSettings} />
      </SuperAdminWriteGate>

      {/* キャラボイス アップロード */}
      <SuperAdminWriteGate silent>
        <GameAudioClient initial={gameAudioItems} />
      </SuperAdminWriteGate>

      {/* キャラクター画像 アップロード (1ポーズ最大3パターン) */}
      <SuperAdminWriteGate silent>
        <CharacterImageClient initial={characterImageItems} />
      </SuperAdminWriteGate>
    </main>
  );
}
