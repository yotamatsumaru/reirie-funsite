/**
 * あっち向いてホイ用のサウンド定義。
 *
 * --- 設計方針 ---
 * ・効果音 (SE) は静的ファイル (public/audio/se-*.mp3) で固定。常に有効。
 * ・キャラボイス (voice-*) は「管理画面からアップロード」する運用。
 *   → ゲームページ (server component) が DB から slot→URL を取得し、
 *     AcchiGameClient 経由で useAcchiSound に渡す。
 *   → URL が無いスロットは黙ってスキップ (エラーにしない)。
 *
 * これにより、コードを触らずに管理画面でボイスを差し替えられる。
 */
import type { AcchiVoiceSlot, AcchiVoiceUrlMap } from '@idol/shared';

/** 効果音を鳴らすか (ファイルは配置済み)。 */
export const SE_ENABLED = true;

/** サウンド 1 件の定義。 */
export type SoundDef = {
  /** 再生する URL (public 相対 or 絶対)。 */
  src: string;
  /** 既定音量 (0.0〜1.0)。 */
  volume: number;
  /** ボイス扱い (URL が動的に注入される。未設定なら鳴らさない)。 */
  voice?: boolean;
};

/** 効果音キー。 */
export type SeKey = 'tap' | 'win' | 'lose' | 'draw' | 'point';

/** ボイスキー = 共有のスロット識別子。 */
export type VoiceKey = AcchiVoiceSlot;

/** 全サウンドキー。 */
export type SoundKey = SeKey | VoiceKey;

/** 効果音 (SE) 定義。 */
export const SE: Record<SeKey, SoundDef> = {
  tap: { src: '/audio/se-tap.mp3', volume: 0.5 },
  win: { src: '/audio/se-win.mp3', volume: 0.6 },
  lose: { src: '/audio/se-lose.mp3', volume: 0.5 },
  draw: { src: '/audio/se-draw.mp3', volume: 0.5 },
  point: { src: '/audio/se-point.mp3', volume: 0.6 },
};

/** ボイスの既定音量。 */
export const VOICE_VOLUME = 1.0;

/**
 * ボイス URL マップ (slot→URL) から、再生用のサウンド定義マップを作る。
 * URL が無いスロットは含めない。
 */
export function buildVoiceDefs(urls: AcchiVoiceUrlMap): Partial<Record<VoiceKey, SoundDef>> {
  const defs: Partial<Record<VoiceKey, SoundDef>> = {};
  for (const [slot, url] of Object.entries(urls)) {
    if (url) {
      defs[slot as VoiceKey] = { src: url, volume: VOICE_VOLUME, voice: true };
    }
  }
  return defs;
}

/** localStorage のミュート設定キー。 */
export const SOUND_MUTE_STORAGE_KEY = 'acchi:muted';
