'use client';

/**
 * あっちむいてホイ用の「トリガー」風方向入力 UI。
 *
 * 従来の 3x3 矢印ボタン (上下左右をタップで選ぶ) を廃止し、
 * 中央のノブを指 (タッチ) / マウスでつまんで、指したい方向へ
 * ドラッグ → 離す (トリガーを引く) ことで方向を決定する、
 * ゲームコントローラーのトリガー/スティックに近い操作感にする。
 *
 * Pointer Events API (pointerdown/pointermove/pointerup) を使うことで、
 * マウスとタッチの両方を同一のロジックで扱う (別実装が不要)。
 *
 * 判定ロジック:
 *  - ドラッグ距離が RELEASE_THRESHOLD_PX 未満で離した場合は「未確定」として
 *    キャンセル (方向は選ばれない、ノブは中央に戻る)。
 *  - しきい値以上ドラッグしていれば、ドラッグ量の絶対値が大きい軸
 *    (縦 or 横) を採用し、その符号から上下左右のいずれかを決定する
 *    (斜めドラッグでも迷わず 4 方向のいずれかに丸められる)。
 *  - キーボード操作 (矢印キー) でも同じ結果を選べるようにし、
 *    アクセシビリティを確保する。
 */
import { useCallback, useRef, useState } from 'react';
import type { AcchiDirection } from '@idol/shared';
import { DirectionIcon } from './DirectionIcon';

/** これ未満のドラッグ距離 (px) で離したらキャンセル扱い。 */
const RELEASE_THRESHOLD_PX = 26;
/** ノブの見た目上の最大移動距離 (px)。 */
const MAX_KNOB_OFFSET_PX = 58;

/** 中央ノブがアイドル状態のときに表示するブランドマーク (十字/照準)。 */
function KnobIdleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <line x1="12" y1="1.5" x2="12" y2="5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="12" y1="19" x2="12" y2="22.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="1.5" y1="12" x2="5" y2="12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="19" y1="12" x2="22.5" y2="12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** ドラッグ量 (dx, dy) から 4 方向のいずれかを決定する。 */
function resolveDirection(dx: number, dy: number): AcchiDirection {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'RIGHT' : 'LEFT';
  }
  return dy > 0 ? 'DOWN' : 'UP';
}

type Props = {
  /** ユーザーが方向を確定した (トリガーを引いた) ときに呼ばれる。 */
  onSelect: (dir: AcchiDirection) => void;
  disabled?: boolean;
};

export function DirectionTrigger({ onSelect, disabled = false }: Props) {
  const [dragging, setDragging] = useState(false);
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });
  const [activeDir, setActiveDir] = useState<AcchiDirection | null>(null);

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const lastDeltaRef = useRef({ dx: 0, dy: 0 });

  const reset = useCallback(() => {
    setDragging(false);
    setKnobOffset({ x: 0, y: 0 });
    setActiveDir(null);
    startRef.current = null;
    lastDeltaRef.current = { dx: 0, dy: 0 };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      startRef.current = { x: e.clientX, y: e.clientY };
      lastDeltaRef.current = { dx: 0, dy: 0 };
      setDragging(true);
      setActiveDir(null);
      setKnobOffset({ x: 0, y: 0 });
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      lastDeltaRef.current = { dx, dy };

      const dist = Math.hypot(dx, dy);
      const clampedDist = Math.min(dist, MAX_KNOB_OFFSET_PX);
      const scale = dist > 0 ? clampedDist / dist : 0;
      setKnobOffset({ x: dx * scale, y: dy * scale });
      setActiveDir(dist >= RELEASE_THRESHOLD_PX ? resolveDirection(dx, dy) : null);
    },
    [disabled],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!startRef.current) return;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const { dx, dy } = lastDeltaRef.current;
      const dist = Math.hypot(dx, dy);
      const shouldFire = !disabled && dist >= RELEASE_THRESHOLD_PX;
      const dir = shouldFire ? resolveDirection(dx, dy) : null;
      reset();
      if (dir) onSelect(dir);
    },
    [disabled, onSelect, reset],
  );

  const handlePointerCancel = useCallback(() => {
    reset();
  }, [reset]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const map: Record<string, AcchiDirection> = {
        ArrowUp: 'UP',
        ArrowDown: 'DOWN',
        ArrowLeft: 'LEFT',
        ArrowRight: 'RIGHT',
      };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      onSelect(dir);
    },
    [disabled, onSelect],
  );

  return (
    <div className="mx-auto flex flex-col items-center gap-3 select-none">
      <div
        role="slider"
        aria-label="方向トリガー: ドラッグして指したい方向へ離す"
        aria-valuetext={activeDir ?? '未選択'}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
        className={`relative flex h-56 w-56 items-center justify-center rounded-full border-4 touch-none ${
          disabled
            ? 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-60'
            : 'cursor-grab border-twilight-amethyst/40 bg-gradient-to-br from-purple-50 to-white shadow-inner active:cursor-grabbing'
        } ${dragging ? 'border-twilight-amethyst' : ''}`}
      >
        {/* 4方向の目印 (アクティブな方向だけ強調表示) */}
        {(['UP', 'DOWN', 'LEFT', 'RIGHT'] as AcchiDirection[]).map((dir) => {
          const pos =
            dir === 'UP'
              ? 'left-1/2 top-3 -translate-x-1/2'
              : dir === 'DOWN'
                ? 'bottom-3 left-1/2 -translate-x-1/2'
                : dir === 'LEFT'
                  ? 'left-3 top-1/2 -translate-y-1/2'
                  : 'right-3 top-1/2 -translate-y-1/2';
          const isActive = activeDir === dir;
          return (
            <span
              key={dir}
              className={`pointer-events-none absolute transition-all duration-100 ${pos} ${
                isActive
                  ? 'scale-125 text-twilight-amethyst opacity-100'
                  : 'text-twilight-amethyst/50 opacity-40'
              }`}
            >
              <DirectionIcon dir={dir} className="h-6 w-6" />
            </span>
          );
        })}

        {/* 外周ガイド (点線の円) */}
        <div className="pointer-events-none absolute inset-3 rounded-full border-2 border-dashed border-twilight-amethyst/20" />

        {/* つまんで動かすノブ (トリガー本体) */}
        <div
          className={`pointer-events-none flex h-20 w-20 items-center justify-center rounded-full border-2 shadow-md transition-transform ${
            dragging
              ? 'border-twilight-amethyst bg-twilight-amethyst/90 text-white duration-0'
              : 'border-twilight-amethyst/50 bg-white text-twilight-amethyst duration-200'
          }`}
          style={{
            transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
          }}
        >
          {activeDir ? (
            <DirectionIcon dir={activeDir} className="h-9 w-9" strokeWidth={2.8} />
          ) : (
            <KnobIdleMark className="h-9 w-9" />
          )}
        </div>
      </div>
      <p className="text-xs text-slate-400">
        中央をつまんで、指したい方向へドラッグして離してね (矢印キーでも操作できます)
      </p>
    </div>
  );
}
