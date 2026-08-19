'use client';

/**
 * スロットのリール 1 本分の表示コンポーネント。
 *
 * === どうやって「回っている」ように見せているか ===
 * 絵柄を縦に並べた「ストリップ」を 2 周分つなげて、CSS アニメーション
 * (animate-slot-spin) で -50% までスクロールさせている。
 * 2 周分あるので -50% 到達時に必ず元と同じ絵柄位置に戻り、ループの継ぎ目が見えない。
 *
 * 停止時はアニメーションを外し、サーバーが確定した絵柄を 1 つだけ表示する。
 * 表示する絵柄は必ず props (= サーバーのレスポンス) から来るので、
 * クライアント側の乱数で見た目が決まることはない。
 */
import { SLOT_SYMBOLS, SLOT_SYMBOL_EMOJI, SLOT_SYMBOL_LABEL, type SlotSymbol } from '@idol/shared';

/** 回転中に流れるストリップ (絵柄列を 2 周分並べる) */
const STRIP: SlotSymbol[] = [...SLOT_SYMBOLS, ...SLOT_SYMBOLS];

export function SlotReel({
  symbol,
  spinning,
  fast = false,
  highlight = false,
}: {
  /** 停止時に表示する絵柄。回転中 (spinning) は無視される。 */
  symbol: SlotSymbol | null;
  /** 回転中か */
  spinning: boolean;
  /** 高速回転 (回し始め)。false だとゆっくり回り「減速して止まる」感が出る。 */
  fast?: boolean;
  /** 当たりの一部として光らせるか */
  highlight?: boolean;
}) {
  return (
    <div
      className={[
        'relative h-24 w-20 overflow-hidden rounded-xl border-4 border-black bg-white shadow-[3px_3px_0_rgba(0,0,0,0.9)] sm:h-28 sm:w-24',
        highlight ? 'animate-slot-win-glow bg-amber-50' : '',
      ].join(' ')}
      // 回転中は絵柄が読み取れないので、スクリーンリーダーには状態だけを伝える。
      role="img"
      aria-label={
        spinning
          ? 'リール回転中'
          : symbol
            ? `リール: ${SLOT_SYMBOL_LABEL[symbol]}`
            : 'リール: 停止'
      }
    >
      {spinning ? (
        <div className={fast ? 'animate-slot-spin-fast' : 'animate-slot-spin'} aria-hidden>
          {STRIP.map((s, i) => (
            <div
              key={`${s}-${i}`}
              className="flex h-24 w-full items-center justify-center text-4xl sm:h-28 sm:text-5xl"
            >
              {SLOT_SYMBOL_EMOJI[s]}
            </div>
          ))}
        </div>
      ) : (
        <div
          // key を絵柄にしておくと、絵柄が変わるたびに停止バウンドが再生される。
          key={symbol ?? 'empty'}
          className="animate-slot-stop flex h-full w-full items-center justify-center text-4xl sm:text-5xl"
          aria-hidden
        >
          {symbol ? SLOT_SYMBOL_EMOJI[symbol] : '—'}
        </div>
      )}

      {/* 中央のペイライン (見た目だけ。判定には影響しない) */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-rose-400/40" />
    </div>
  );
}
