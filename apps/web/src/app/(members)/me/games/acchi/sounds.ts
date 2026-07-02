/**
 * あっち向いてホイ用のサウンド定義。
 *
 * --- 設計方針 (character.ts と同じ思想) ---
 * ファイルが存在すれば再生、無ければ黙ってスキップ (エラーにしない)。
 * これにより「効果音は用意済み・ボイスは後から差し替え」が安全にできる。
 *
 * --- ボイス(REIRIE の声)を後から差し替える方法 ---
 * 1. 下記 `VOICE` の各 src が指すパス (= apps/web/public/audio/) に
 *    収録した mp3 を置く。想定ファイル名:
 *      voice-start.mp3 … ゲーム開始「じゃんけん、いくよ〜！」
 *      voice-acchi.mp3 … あっち向いてホイ「あっち向いて…ホイ！」
 *      voice-win.mp3   … プレイヤー勝ち「わっ、負けちゃった〜！やるね！」
 *      voice-lose.mp3  … プレイヤー負け「えへへ、私の勝ち♪」
 *      voice-draw.mp3  … あいこ「あれ、同じだ！もう一回！」
 * 2. `VOICE_ENABLED` を true にする。
 *    → ファイルが存在すればボイス再生、無ければ自動でスキップ。
 *
 * 効果音 (SE) は既に配置済みなので `SE_ENABLED` は true。
 * 音量やファイル名を変えたい場合はこの定義だけ編集すればよい。
 */

/** 効果音を鳴らすか (ファイルは配置済み)。 */
export const SE_ENABLED = true;

/**
 * ボイスを鳴らすか。
 * 収録音源 (voice-*.mp3) を public/audio に置いたら true にする。
 * false のうちは効果音のみで動作する。
 */
export const VOICE_ENABLED = false;

/** サウンド 1 件の定義。 */
export type SoundDef = {
  /** public からの絶対パス。 */
  src: string;
  /** 既定音量 (0.0〜1.0)。 */
  volume: number;
  /** ボイス扱い (VOICE_ENABLED が false のときは鳴らさない)。 */
  voice?: boolean;
};

/** サウンドキー (再生時に指定する)。 */
export type SoundKey =
  | 'tap'
  | 'win'
  | 'lose'
  | 'draw'
  | 'point'
  | 'voiceStart'
  | 'voiceAcchi'
  | 'voiceWin'
  | 'voiceLose'
  | 'voiceDraw';

/** 効果音 (SE) 定義。 */
const SE: Record<string, SoundDef> = {
  tap: { src: '/audio/se-tap.mp3', volume: 0.5 },
  win: { src: '/audio/se-win.mp3', volume: 0.6 },
  lose: { src: '/audio/se-lose.mp3', volume: 0.5 },
  draw: { src: '/audio/se-draw.mp3', volume: 0.5 },
  point: { src: '/audio/se-point.mp3', volume: 0.6 },
};

/** ボイス定義 (差し替え用。ファイルが無ければ自動スキップ)。 */
const VOICE: Record<string, SoundDef> = {
  voiceStart: { src: '/audio/voice-start.mp3', volume: 1.0, voice: true },
  voiceAcchi: { src: '/audio/voice-acchi.mp3', volume: 1.0, voice: true },
  voiceWin: { src: '/audio/voice-win.mp3', volume: 1.0, voice: true },
  voiceLose: { src: '/audio/voice-lose.mp3', volume: 1.0, voice: true },
  voiceDraw: { src: '/audio/voice-draw.mp3', volume: 1.0, voice: true },
};

/** 全サウンド定義。 */
export const SOUNDS: Record<SoundKey, SoundDef> = {
  ...SE,
  ...VOICE,
} as Record<SoundKey, SoundDef>;

/** localStorage のミュート設定キー。 */
export const SOUND_MUTE_STORAGE_KEY = 'acchi:muted';
