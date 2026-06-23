/**
 * Rosy Twilight 背景エフェクト
 *
 * Hero などの上に重ねる装飾レイヤー。
 *  - Twilight グラデーション (bg-twilight)
 *  - フォググレイン (ふわっとした霧)
 *  - sparkle (きらめき)
 *
 * sparkle 座標は固定配列にして SSR / CSR の hydration mismatch を防ぐ。
 * 純粋な装飾なので aria-hidden / pointer-events-none。
 */

const SPARKLES = [
  { top: '12%', left: '18%', size: 4, delay: '0s', dur: '3.2s' },
  { top: '22%', left: '74%', size: 6, delay: '0.6s', dur: '3.8s' },
  { top: '35%', left: '42%', size: 3, delay: '1.2s', dur: '2.8s' },
  { top: '48%', left: '88%', size: 5, delay: '0.3s', dur: '4.1s' },
  { top: '58%', left: '12%', size: 4, delay: '1.8s', dur: '3.5s' },
  { top: '66%', left: '63%', size: 3, delay: '0.9s', dur: '3.0s' },
  { top: '74%', left: '30%', size: 5, delay: '2.1s', dur: '4.4s' },
  { top: '82%', left: '80%', size: 4, delay: '1.5s', dur: '3.3s' },
  { top: '15%', left: '55%', size: 3, delay: '2.4s', dur: '2.9s' },
  { top: '40%', left: '8%', size: 5, delay: '0.4s', dur: '3.7s' },
] as const;

type TwilightBackdropProps = {
  /** グラデーション背景を含める (Hero 全面で true、部分装飾で false) */
  withGradient?: boolean;
  className?: string;
};

export function TwilightBackdrop({
  withGradient = true,
  className = '',
}: TwilightBackdropProps) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      {withGradient && <div className="absolute inset-0 bg-twilight" />}

      {/* フォググレイン (2 層をゆっくりドリフトさせる) */}
      <div className="fog-grain animate-fog-drift" />
      <div
        className="fog-grain animate-fog-drift"
        style={{ animationDelay: '-9s', opacity: 0.7 }}
      />

      {/* sparkle */}
      {SPARKLES.map((s, i) => (
        <span
          key={i}
          className="animate-sparkle absolute rounded-full bg-twilight-cream"
          style={{
            top: s.top,
            left: s.left,
            width: `${s.size}px`,
            height: `${s.size}px`,
            animationDelay: s.delay,
            animationDuration: s.dur,
            boxShadow: '0 0 8px rgba(251, 238, 245, 0.9)',
          }}
        />
      ))}
    </div>
  );
}
