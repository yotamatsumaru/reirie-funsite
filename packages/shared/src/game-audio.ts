/**
 * ゲーム音声 (あっち向いてホイのキャラボイス) のスロット定義。
 *
 * ここは純粋な定数のみ (DB 非依存)。管理画面のアップロード UI と、ゲーム側の
 * 再生ロジックの両方が同じスロット定義を参照することで、ファイル名/用途のズレを防ぐ。
 *
 * 効果音 (SE) は静的ファイル (public/audio/se-*.mp3) で固定のため、ここには含めない。
 * ここで扱うのは「管理画面から差し替えたいボイス」だけ。
 */

/** ボイススロット識別子 (DB GameAudio.slot に保存する値)。 */
export const ACCHI_VOICE_SLOTS = [
  'voiceStart',
  'voiceAcchi',
  'voiceWin',
  'voiceLose',
  'voiceDraw',
] as const;

export type AcchiVoiceSlot = (typeof ACCHI_VOICE_SLOTS)[number];

/** slot が有効なボイススロットか。 */
export function isAcchiVoiceSlot(v: unknown): v is AcchiVoiceSlot {
  return typeof v === 'string' && (ACCHI_VOICE_SLOTS as readonly string[]).includes(v);
}

/** 各スロットのメタ情報 (管理画面表示用)。 */
export type AcchiVoiceSlotMeta = {
  slot: AcchiVoiceSlot;
  /** 管理画面に出す見出し */
  label: string;
  /** 鳴るタイミングの説明 */
  timing: string;
  /** 収録用のセリフ例 */
  scriptExample: string;
};

export const ACCHI_VOICE_SLOT_META: Record<AcchiVoiceSlot, AcchiVoiceSlotMeta> = {
  voiceStart: {
    slot: 'voiceStart',
    label: 'ゲーム開始',
    timing: 'じゃんけんの手を選んだとき',
    scriptExample: 'じゃんけん、いくよ〜！',
  },
  voiceAcchi: {
    slot: 'voiceAcchi',
    label: 'あっち向いてホイ',
    timing: '方向を選んだとき',
    scriptExample: 'あっち向いて…ホイ！',
  },
  voiceWin: {
    slot: 'voiceWin',
    label: 'ファンの勝ち',
    timing: 'プレイヤーが勝ったとき',
    scriptExample: 'わっ、負けちゃった〜！キミ、やるね♪',
  },
  voiceLose: {
    slot: 'voiceLose',
    label: 'ファンの負け',
    timing: 'プレイヤーが負けたとき',
    scriptExample: 'えへへ、私の勝ち♪',
  },
  voiceDraw: {
    slot: 'voiceDraw',
    label: 'あいこ',
    timing: '勝負がつかなかったとき',
    scriptExample: 'あれ、同じだ！もう一回っ！',
  },
};

/** slot → 公開URL のマップ (未設定スロットは欠落)。 */
export type AcchiVoiceUrlMap = Partial<Record<AcchiVoiceSlot, string>>;

/** アップロード可能な音声の MIME → 拡張子。 */
export const ALLOWED_AUDIO_TYPES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/x-m4a': 'm4a',
};

/** 音声 1 ファイルの最大サイズ (5MB)。掛け声・短いセリフを想定。 */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
