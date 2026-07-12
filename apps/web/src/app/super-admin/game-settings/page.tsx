/**
 * /super-admin/game-settings — ゲーム設定
 *
 * あっち向いてホイ等のゲームの「設定」を集約する専用ページ。
 * 売上・統計を扱う「ゲーム経済」(/super-admin/game) とは役割を分離している:
 *   - ゲーム経済 … DLC 売上 / アイテム集計 / プレイヤー統計 (数値の閲覧)
 *   - ゲーム設定 … 勝率 / 特典ポイントボーナス / キャラボイス / キャラクター画像 (挙動の設定)
 */
import type { Metadata } from 'next';
import { getAcchiWinSettings, getAcchiRewardBonusSettings } from '@/lib/app-setting';
import { listGameAudio } from '@/lib/game-audio';
import { listCharacterImages } from '@/lib/character-image';
import { AcchiSettingsClient } from './acchi-settings-client';
import { AcchiRewardBonusClient } from './acchi-reward-bonus-client';
import { GameAudioClient, type GameAudioItem } from './game-audio-client';
import { CharacterImageClient, type CharacterImageItem } from './character-image-client';

export const metadata: Metadata = { title: 'ゲーム設定 | Super Admin' };
export const dynamic = 'force-dynamic';

export default async function SuperAdminGameSettingsPage() {
  const [acchiSettings, acchiRewardBonusSettings, gameAudio, characterImages] = await Promise.all([
    getAcchiWinSettings(),
    getAcchiRewardBonusSettings(),
    listGameAudio(),
    listCharacterImages(),
  ]);

  const gameAudioItems: GameAudioItem[] = gameAudio.map((a) => ({
    slot: a.slot,
    url: a.url,
    fileName: a.fileName,
    sizeBytes: a.sizeBytes,
    updatedAt: a.updatedAt.toISOString(),
  }));
  const characterImageItems: CharacterImageItem[] = characterImages.map((a) => ({
    slot: a.slot,
    variant: a.variant,
    url: a.url,
    fileName: a.fileName,
    sizeBytes: a.sizeBytes,
    updatedAt: a.updatedAt.toISOString(),
  }));

  return (
    <main>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">ゲーム設定</h1>
        <p className="mt-1 text-sm text-slate-500">
          あっち向いてホイの勝率・特典ボーナス・キャラボイス・キャラクター画像などの設定。
          売上・統計は「ゲーム経済」で確認できます。
        </p>
      </header>

      {/* あっち向いてホイ 勝率設定 */}
      <AcchiSettingsClient initial={acchiSettings} />

      {/* あっち向いてホイ 勝利特典ポイントボーナス設定 */}
      <AcchiRewardBonusClient initial={acchiRewardBonusSettings} />

      {/* あっち向いてホイ キャラボイス アップロード */}
      <GameAudioClient initial={gameAudioItems} />

      {/* あっち向いてホイ キャラクター画像 アップロード (1ポーズ最大3パターン) */}
      <CharacterImageClient initial={characterImageItems} />
    </main>
  );
}
