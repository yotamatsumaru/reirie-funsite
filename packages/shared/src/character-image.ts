/**
 * あっち向いてホイ用キャラクター画像 (ポーズごとの差し替え可能画像) のスロット定義。
 *
 * ここは純粋な定数のみ (DB 非依存)。管理画面のアップロード UI と、
 * ゲーム画面 (CharacterAvatar) の両方が同じスロット定義を参照することで、
 * 用途のズレを防ぐ。
 *
 * site-image.ts / game-audio.ts と同じ設計方針: スロット (= ポーズ) ごとに
 * 1 件だけ保持し、再アップロードで置き換える。コード変更・再デプロイ不要で
 * 差し替え可能にする。
 *
 * スロット値は apps/web 側の `CharacterPose`
 * (apps/web/src/app/(members)/me/games/acchi/character.ts) と一致させる:
 *   idle      … 待機(正面)
 *   rock      … グー
 *   scissors  … チョキ
 *   paper     … パー
 *   up        … 上向き(横顔)
 *   down      … 下向き(横顔)
 *   left      … 左向き(横顔)
 *   right     … 右向き(横顔)
 */

/** 画像スロット識別子 (DB CharacterImage.slot に保存する値)。 */
export const CHARACTER_IMAGE_SLOTS = [
  'idle',
  'rock',
  'scissors',
  'paper',
  'up',
  'down',
  'left',
  'right',
] as const;

export type CharacterImageSlot = (typeof CHARACTER_IMAGE_SLOTS)[number];

/** slot が有効なキャラクター画像スロットか。 */
export function isCharacterImageSlot(v: unknown): v is CharacterImageSlot {
  return typeof v === 'string' && (CHARACTER_IMAGE_SLOTS as readonly string[]).includes(v);
}

/**
 * 1 つのポーズ (slot) につき登録できる画像パターンの最大数。
 * ゲーム表示時は、そのポーズに登録されているパターンからランダムに 1 枚が選ばれる。
 */
export const CHARACTER_IMAGE_VARIANTS_PER_SLOT = 3;

/** 登録可能なパターン番号の一覧 (例: [1, 2, 3])。 */
export const CHARACTER_IMAGE_VARIANTS: number[] = Array.from(
  { length: CHARACTER_IMAGE_VARIANTS_PER_SLOT },
  (_, i) => i + 1,
);

/** variant が有効なパターン番号 (1〜CHARACTER_IMAGE_VARIANTS_PER_SLOT) か。 */
export function isCharacterImageVariant(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 1 &&
    v <= CHARACTER_IMAGE_VARIANTS_PER_SLOT
  );
}

/** 各スロットのメタ情報 (管理画面表示用)。 */
export type CharacterImageSlotMeta = {
  slot: CharacterImageSlot;
  /** 管理画面に出す見出し */
  label: string;
  /** 表示箇所の説明 */
  description: string;
};

export const CHARACTER_IMAGE_SLOT_META: Record<CharacterImageSlot, CharacterImageSlotMeta> = {
  idle: {
    slot: 'idle',
    label: '待機',
    description: 'じゃんけん前の待機ポーズ (正面)。',
  },
  rock: {
    slot: 'rock',
    label: 'グー',
    description: 'じゃんけんで「グー」を出したときの手のポーズ。',
  },
  scissors: {
    slot: 'scissors',
    label: 'チョキ',
    description: 'じゃんけんで「チョキ」を出したときの手のポーズ。',
  },
  paper: {
    slot: 'paper',
    label: 'パー',
    description: 'じゃんけんで「パー」を出したときの手のポーズ。',
  },
  up: {
    slot: 'up',
    label: '上向き',
    description: 'あっちむいてPUIで上を向いたときの横顔。',
  },
  down: {
    slot: 'down',
    label: '下向き',
    description: 'あっちむいてPUIで下を向いたときの横顔。',
  },
  left: {
    slot: 'left',
    label: '左向き',
    description: 'あっちむいてPUIで左を向いたときの横顔。',
  },
  right: {
    slot: 'right',
    label: '右向き',
    description: 'あっちむいてPUIで右を向いたときの横顔。',
  },
};

/**
 * slot → 公開URL のマップ (未設定スロットは欠落)。
 * 1 ポーズにつき最大 CHARACTER_IMAGE_VARIANTS_PER_SLOT 枚の URL を配列で保持し、
 * ゲーム表示時にこの中からランダムに 1 枚が選ばれる。
 */
export type CharacterImageUrlMap = Partial<Record<CharacterImageSlot, string[]>>;

/** アップロード可能な画像の MIME → 拡張子。 */
export const ALLOWED_CHARACTER_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** 画像 1 ファイルの最大サイズ (8MB)。 */
export const MAX_CHARACTER_IMAGE_BYTES = 8 * 1024 * 1024;
