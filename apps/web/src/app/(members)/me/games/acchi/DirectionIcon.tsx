'use client';

/**
 * あっちむいてPUI 用の方向アイコン (ブランド SVG)。
 *
 * 以前は絵文字 (⬆️⬇️⬅️➡️ / ☝️👇👈👉 / 🎮) を使っていたが、
 * OS 依存で見た目がバラつき、サイトのネオブルータリズム的な
 * デザイン (border-2 border-black / twilight-rose・amethyst) と
 * 調和しないため、インライン SVG の矢印に統一する。
 *
 * `currentColor` を使うので、利用側は text-* / className で色を制御できる。
 */
import type { AcchiDirection } from '@idol/shared';

/** UP を基準に、方向ごとの回転量 (deg)。 */
const DIR_ROTATION: Record<AcchiDirection, number> = {
  UP: 0,
  RIGHT: 90,
  DOWN: 180,
  LEFT: 270,
};

type DirectionIconProps = {
  dir: AcchiDirection;
  className?: string;
  /** 太めの丸い矢印グリフ。currentColor で塗る。 */
  strokeWidth?: number;
};

/**
 * 丸みのあるシェブロン + シャフトの矢印。太めのストロークで
 * ネオブルータリズムのカードに馴染むようにしている。
 */
export function DirectionIcon({ dir, className, strokeWidth = 2.6 }: DirectionIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ transform: `rotate(${DIR_ROTATION[dir]}deg)` }}
    >
      {/* シャフト */}
      <line x1="12" y1="20" x2="12" y2="6" />
      {/* 矢じり */}
      <path d="M6 11l6-6 6 6" />
    </svg>
  );
}
