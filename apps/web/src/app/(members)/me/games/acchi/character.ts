/**
 * あっち向いてホイ用キャラクター画像の差し替え設定。
 *
 * --- 後から本人(REIRIE)の画像に差し替える方法 ---
 * 1. 下記 `CHARACTER_IMAGE_DIR` のディレクトリ
 *    (= apps/web/public/characters/reirie/) に画像を置く。
 * 2. 必要なファイル名は `CHARACTER_POSES` のキーに対応:
 *      idle.png      … 待機(正面)
 *      up.png        … 上向き(横顔)
 *      down.png      … 下向き(横顔)
 *      left.png      … 左向き(横顔)
 *      right.png     … 右向き(横顔)
 *    (拡張子は png / jpg / webp いずれでも可。`CHARACTER_IMAGE_EXT` で変更)
 * 3. `CHARACTER_IMAGES_ENABLED` を true にする。
 *    → 画像が存在すればキャラ画像、無ければ自動で SVG プレースホルダーにフォールバック。
 *
 * 画像を置かない / false のままなら、コードだけで描く SVG キャラ
 * (CharacterAvatar) が表示されるので、見た目は崩れない。
 */

import type { AcchiDirection } from '@idol/shared';

/** public からの相対パス (末尾スラッシュ不要)。 */
export const CHARACTER_IMAGE_DIR = '/characters/reirie';

/** 画像の拡張子。本人画像を webp で置くなら 'webp' などに変更。 */
export const CHARACTER_IMAGE_EXT = 'png';

/**
 * true にすると上記ディレクトリの画像を使う。
 * 画像未配置のうちは false のままで OK (SVG プレースホルダー表示)。
 */
export const CHARACTER_IMAGES_ENABLED = false;

/** キャラ表示名 (吹き出しや alt に使用)。本人名に変えてもよい。 */
export const CHARACTER_NAME = 'REIRIE';

/** ポーズ ID。画像ファイル名 (拡張子なし) と一致させる。 */
export type CharacterPose = 'idle' | 'up' | 'down' | 'left' | 'right';

export const CHARACTER_POSES: CharacterPose[] = ['idle', 'up', 'down', 'left', 'right'];

/** あっち向いて方向 → ポーズ (= 横顔の向き) */
export const DIRECTION_POSE: Record<AcchiDirection, CharacterPose> = {
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
};

/** 指定ポーズの画像 URL を返す。 */
export function characterImageUrl(pose: CharacterPose): string {
  return `${CHARACTER_IMAGE_DIR}/${pose}.${CHARACTER_IMAGE_EXT}`;
}
