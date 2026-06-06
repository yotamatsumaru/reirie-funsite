/**
 * 上部コマンドバー: 親密度ゲージ・セーブ・プレゼント・メニュー
 */
'use client';

export interface CommandMenuProps {
  characterName: string;
  affinity: number; // 0-100
  routeLabel?: string;
  onOpenGift?: () => void;
  onSave?: () => void;
  onClose?: () => void;
}

export function CommandMenu({
  characterName,
  affinity,
  routeLabel,
  onOpenGift,
  onSave,
  onClose,
}: CommandMenuProps) {
  const pct = Math.max(0, Math.min(100, affinity));
  return (
    <div
      className="absolute inset-x-0 top-0 z-20 px-3 py-2 sm:px-5 sm:py-3"
      style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-2 rounded-xl border border-white/20 bg-black/55 px-3 py-2 text-white backdrop-blur-md sm:gap-3 sm:px-4 sm:py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold sm:text-base">{characterName}</span>
            {routeLabel && (
              <span className="rounded bg-pink-500/80 px-1.5 py-0.5 text-[10px]">
                {routeLabel}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-pink-200">親密度</span>
            <div className="h-2 w-full max-w-[200px] overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full bg-gradient-to-r from-pink-400 to-rose-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-pink-100">{pct}</span>
          </div>
        </div>
        {onOpenGift && (
          <button
            type="button"
            onClick={onOpenGift}
            className="rounded-md bg-pink-500/90 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-pink-400 sm:text-sm"
          >
            🎁 贈る
          </button>
        )}
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            className="hidden rounded-md bg-white/15 px-3 py-1.5 text-xs hover:bg-white/25 sm:inline-block sm:text-sm"
          >
            セーブ
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-white/15 px-2 py-1.5 text-xs hover:bg-white/25 sm:px-3 sm:text-sm"
            aria-label="閉じる"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
