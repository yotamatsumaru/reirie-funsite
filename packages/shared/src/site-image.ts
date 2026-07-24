/**
 * サイト内の差し替え可能画像（トップページのヒーロー画像など）のスロット定義。
 *
 * ここは純粋な定数のみ (DB 非依存)。管理画面のアップロード UI と、
 * 表示側 (トップページ等) の両方が同じスロット定義を参照することで、
 * 用途のズレを防ぐ。
 *
 * game-audio.ts と同じ設計方針: スロットごとに 1 件だけ保持し、
 * 再アップロードで置き換える。コード変更・再デプロイ不要で差し替え可能にする。
 */

/** 画像スロット識別子 (DB SiteImage.slot に保存する値)。 */
export const SITE_IMAGE_SLOTS = [
  'home.hero',
  'home.hero.desktop',
  'game.acchi.thumbnail',
] as const;

export type SiteImageSlot = (typeof SITE_IMAGE_SLOTS)[number];

/** slot が有効なサイト画像スロットか。 */
export function isSiteImageSlot(v: unknown): v is SiteImageSlot {
  return typeof v === 'string' && (SITE_IMAGE_SLOTS as readonly string[]).includes(v);
}

/**
 * ミニゲームのサムネイル画像スロット。
 * ゲーム一覧 (/game) のカードに表示する画像。未設定なら絵文字プレースホルダー。
 * 将来ゲームが増えたら `game.<slug>.thumbnail` を SITE_IMAGE_SLOTS に追加する。
 */
export function gameThumbnailSlot(gameSlug: string): string {
  return `game.${gameSlug}.thumbnail`;
}

/** 各スロットのメタ情報 (管理画面表示用)。 */
export type SiteImageSlotMeta = {
  slot: SiteImageSlot;
  /** 管理画面に出す見出し */
  label: string;
  /** 表示箇所の説明 */
  description: string;
  /** 推奨アスペクト比 (表示の目安) */
  recommendedAspect: string;
};

export const SITE_IMAGE_SLOT_META: Record<SiteImageSlot, SiteImageSlotMeta> = {
  'home.hero': {
    slot: 'home.hero',
    label: 'トップページ ヒーロー画像 (スマホ用・縦長)',
    description:
      'トップページ最上部に表示されるメインビジュアルです。スマートフォン表示で使われます (PC用が未設定の場合はPCでもこの画像を使用)。',
    recommendedAspect: '縦長 4:5 推奨 (例: 1200×1500px)',
  },
  'home.hero.desktop': {
    slot: 'home.hero.desktop',
    label: 'トップページ ヒーロー画像 (PC用・横長)',
    description:
      'トップページ最上部に表示されるメインビジュアルです。パソコン表示で使われます (未設定の場合はスマホ用の縦長画像を使用)。',
    recommendedAspect: '横長 16:9〜21:9 推奨 (例: 2400×1000px)',
  },
  'game.acchi.thumbnail': {
    slot: 'game.acchi.thumbnail',
    label: 'あっちむいてPUI サムネイル',
    description:
      'ゲーム一覧 (/game) のミニゲームカードに表示するサムネイル画像です。未設定の場合は絵文字が表示されます。',
    recommendedAspect: '横長 16:9 推奨 (例: 1280×720px)',
  },
};

/** slot → 公開URL のマップ (未設定スロットは欠落)。 */
export type SiteImageUrlMap = Partial<Record<SiteImageSlot, string>>;

/** アップロード可能な画像の MIME → 拡張子。 */
export const ALLOWED_SITE_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** 画像 1 ファイルの最大サイズ (8MB)。 */
export const MAX_SITE_IMAGE_BYTES = 8 * 1024 * 1024;
