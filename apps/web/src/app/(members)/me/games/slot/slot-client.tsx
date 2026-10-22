'use client';

/**
 * スロット ミニゲーム (クライアント UI)。
 *
 * 【重要】このコンポーネントは「演出」だけを担当する。
 * 役の抽選・停止絵柄・獲得 Pui はすべてサーバー (POST /api/me/games/slot) が確定する。
 * クライアントは「回す」というリクエストを送るだけで、結果やポイントは一切送らない。
 * → クライアント側を改造しても不正に Pui を得ることはできない。
 *
 * 演出フロー:
 *  1. レバーを押す → 3 リールが回り始める (API 送信)
 *  2. レスポンス到着後、左 → 中 → 右 の順に時間差で停止させる
 *     (実機と同じ「1 つずつ止まる」テンポ。テンパイ時の緊張感を出すため)
 *  3. 全リール停止 → 役と獲得 Pui を表示
 *
 * ※ API のレスポンスが早すぎると演出が一瞬で終わってしまうため、
 *   最低でも MIN_SPIN_MS は回してから停止処理に入る。
 *
 * 見た目テーマ (通常 / ハロウィン) はサーバーが解決して initial.theme で渡す。
 * テーマで変わるのは絵柄の絵文字・名前・文言・配色だけで、役・確率・配当は共通。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  SLOT_SYMBOLS,
  SLOT_THEME_DEFINITIONS,
  SLOT_TRIPLE_SYMBOL,
  type SlotOutcome,
  type SlotSymbol,
  type SlotTheme,
  type SlotThemeDefinition,
} from '@idol/shared';
import { Button } from '@/components/ui/Button';
import { SlotReel } from './SlotReel';

type Initial = {
  date: string;
  /** 見た目テーマ (サーバーが管理画面の設定 + 期間から解決) */
  theme: SlotTheme;
  baseMaxPerDay: number;
  maxPerDay: number;
  playedToday: number;
  remaining: number;
  /** プロモ/デモアカウントで、プレイ回数が無制限のとき true。 */
  promoActive?: boolean;
  balance: number;
  maxPayout: number;
  /** 役 → ベース配当 (プラン倍率適用前) */
  payouts: Record<SlotOutcome, number>;
  extraPlay: {
    purchasedToday: number;
    maxPurchasesPerDay: number;
    costPui: number;
    canBuyMore: boolean;
  };
};

type PlayResponse = {
  reels: [SlotSymbol, SlotSymbol, SlotSymbol];
  outcome: SlotOutcome;
  reward: number;
  balance: number;
  playedToday: number;
  remaining: number;
  maxPerDay: number;
};

/** レバーを押してから最初のリールが止まるまでの最短時間 (ms)。演出の下限。 */
const MIN_SPIN_MS = 900;
/** リール 1 本ごとの停止間隔 (ms)。左 → 中 → 右 と順に止める。 */
const REEL_STOP_INTERVAL_MS = 480;
/** 高速回転から低速回転 (減速) に切り替えるまでの時間 (ms)。 */
const SPIN_SLOWDOWN_MS = 500;

/** 配当表に載せる役の並び (高い順)。 */
const PAYOUT_ROWS: Exclude<SlotOutcome, 'LOSE'>[] = [
  'SEVEN_TRIPLE',
  'HEART_TRIPLE',
  'STAR_TRIPLE',
  'WATERMELON_TRIPLE',
  'BELL_TRIPLE',
  'CHERRY_SINGLE',
];

/** 役の見た目 (配当表の絵柄欄) */
function outcomeSymbols(
  outcome: Exclude<SlotOutcome, 'LOSE'>,
  def: SlotThemeDefinition,
): ReactNode {
  if (outcome === 'CHERRY_SINGLE') {
    return (
      <>
        {def.symbolEmoji.CHERRY}
        <span className="ml-1 text-xs text-slate-500">が1つ以上</span>
      </>
    );
  }
  const s = def.symbolEmoji[SLOT_TRIPLE_SYMBOL[outcome]];
  return `${s}${s}${s}`;
}

/** テーマごとの画面の配色 (Tailwind クラス) */
const THEME_STYLE: Record<
  SlotTheme,
  {
    header: string;
    cabinet: string;
    winTitle: string;
    winBadge: string;
    card: string;
    cardTitle: string;
    /** レバー (メインボタン) の上書き配色。空なら Button の既定 */
    lever: string;
  }
> = {
  default: {
    header:
      'border-black bg-twilight-amethyst text-white shadow-[6px_6px_0_rgba(0,0,0,0.9)]',
    cabinet:
      'border-black bg-gradient-to-b from-slate-800 to-slate-900 shadow-[6px_6px_0_rgba(0,0,0,0.9)]',
    winTitle: 'text-amber-300',
    winBadge: 'bg-amber-300 text-amber-950',
    card: 'border-slate-200 bg-white',
    cardTitle: 'text-slate-800',
    lever: '',
  },
  halloween: {
    header:
      'border-black bg-gradient-to-br from-orange-500 via-orange-600 to-purple-800 text-white shadow-[6px_6px_0_rgba(0,0,0,0.9)]',
    cabinet:
      'border-black bg-gradient-to-b from-indigo-950 via-purple-950 to-black shadow-[6px_6px_0_rgba(0,0,0,0.9)]',
    winTitle: 'text-orange-300',
    winBadge: 'bg-orange-400 text-purple-950',
    card: 'border-orange-200 bg-orange-50/60',
    cardTitle: 'text-purple-900',
    lever:
      '!bg-gradient-to-b !from-orange-400 !to-orange-600 !text-purple-950 font-bold hover:!from-orange-300 hover:!to-orange-500 border-2 border-black',
  },
};

/** ハロウィンの筐体に浮かべる飾り (装飾のみ。スクリーンリーダーからは隠す) */
function HalloweenDecorations() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* 満月 */}
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-100/90 shadow-[0_0_40px_12px_rgba(253,230,138,0.35)]" />
      {/* 飛び回るコウモリ */}
      <span className="animate-halloween-bat absolute left-[14%] top-0.5 text-sm">🦇</span>
      <span
        className="animate-halloween-bat absolute right-[26%] top-0.5 text-xs"
        style={{ animationDelay: '-1.4s' }}
      >
        🦇
      </span>
      {/* 足元のかぼちゃ */}
      <span className="animate-halloween-float absolute bottom-1 left-2 text-2xl">🎃</span>
      <span
        className="animate-halloween-float absolute bottom-1 right-2 text-2xl"
        style={{ animationDelay: '-1.1s' }}
      >
        🎃
      </span>
      {/* 蜘蛛の巣 */}
      <span className="absolute -left-1 -top-1 text-3xl opacity-60">🕸️</span>
    </div>
  );
}

export function SlotGameClient({ initial }: { initial: Initial }) {
  const router = useRouter();
  const theme: SlotTheme = initial.theme ?? 'default';
  const def = SLOT_THEME_DEFINITIONS[theme];
  const ts = THEME_STYLE[theme];
  const isHalloween = theme === 'halloween';

  const [remaining, setRemaining] = useState(initial.remaining);
  const [maxPerDay, setMaxPerDay] = useState(initial.maxPerDay);
  const [promoActive] = useState(initial.promoActive ?? false);
  const [balance, setBalance] = useState(initial.balance);
  const [extraPlay, setExtraPlay] = useState(initial.extraPlay);

  /** 各リールが回転中か (左・中・右)。 */
  const [spinning, setSpinning] = useState<[boolean, boolean, boolean]>([false, false, false]);
  /** 高速回転中か (回し始めだけ true にして、減速演出を出す)。 */
  const [fastSpin, setFastSpin] = useState(false);
  /** 停止した絵柄 (未停止は null)。 */
  const [reels, setReels] = useState<[SlotSymbol | null, SlotSymbol | null, SlotSymbol | null]>([
    null,
    null,
    null,
  ]);
  /** 全リール停止後に表示する結果。 */
  const [result, setResult] = useState<PlayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  /**
   * 二重送信 (連打・ダブルタップ) の同期ガード。
   * state は setState が非同期のため、極短時間の連打では 2 回目の onClick が
   * 「まだ回転していない」と誤認して POST が二重に飛ぶ可能性がある。
   * ref なら同期的に更新できるので確実に 1 回に絞れる。
   */
  const submittingRef = useRef(false);
  /** アンマウント後に setState しないためのフラグ (停止演出は setTimeout で遅延するため)。 */
  const mountedRef = useRef(true);
  /** 停止演出用のタイマー。アンマウント時にすべて破棄する。 */
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      if (mountedRef.current) fn();
    }, ms);
    timersRef.current.push(t);
  }, []);

  const canPlay = promoActive || remaining > 0;
  const isSpinning = spinning.some(Boolean);

  /** 1 回転 (レバーを押す)。 */
  async function spin() {
    if (!canPlay || isSpinning || submittingRef.current) return;
    submittingRef.current = true;

    setError(null);
    setResult(null);
    setReels([null, null, null]);
    setSpinning([true, true, true]);
    setFastSpin(true);
    // 少し経ったら減速させる (止まる直前はゆっくり回っているように見せる)。
    later(() => setFastSpin(false), SPIN_SLOWDOWN_MS);

    const startedAt = Date.now();

    try {
      const res = await fetch('/api/me/games/slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'プレイに失敗しました');
      }
      const data = json as PlayResponse;

      // 最低でも MIN_SPIN_MS は回してから停止演出に入る
      // (API が速すぎて一瞬で結果が出ると、回した感触が無くなるため)。
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, MIN_SPIN_MS - elapsed);

      later(() => {
        // 左 → 中 → 右 の順に時間差で止める。
        for (let i = 0; i < 3; i++) {
          later(() => {
            setReels((prev) => {
              const next = [...prev] as [
                SlotSymbol | null,
                SlotSymbol | null,
                SlotSymbol | null,
              ];
              next[i] = data.reels[i];
              return next;
            });
            setSpinning((prev) => {
              const next = [...prev] as [boolean, boolean, boolean];
              next[i] = false;
              return next;
            });
          }, i * REEL_STOP_INTERVAL_MS);
        }

        // 全リールが止まってから結果と残高を反映する
        // (先に残高だけ更新すると、絵柄が出る前に当たりが分かってしまう)。
        later(() => {
          setResult(data);
          setRemaining(data.remaining);
          setMaxPerDay(data.maxPerDay);
          setBalance(data.balance);
          submittingRef.current = false;
        }, 2 * REEL_STOP_INTERVAL_MS + 260);
      }, wait);
    } catch (e) {
      setError((e as Error).message);
      setSpinning([false, false, false]);
      setFastSpin(false);
      submittingRef.current = false;
    }
  }

  /** 追加プレイ回数を Pui で購入する。 */
  async function buyExtraPlay() {
    if (buying || isSpinning) return;
    setBuying(true);
    setError(null);
    try {
      const res = await fetch('/api/me/games/slot/buy-extra-play', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '追加プレイの購入に失敗しました');
      }
      const data = json as {
        balance: number;
        purchasedToday: number;
        maxPerDay: number;
        cost: number;
      };
      setBalance(data.balance);
      setMaxPerDay(data.maxPerDay);
      // 購入した分だけ残り回数が増える。
      setRemaining((prev) => prev + 1);
      setExtraPlay((prev) => ({
        ...prev,
        purchasedToday: data.purchasedToday,
        canBuyMore: data.purchasedToday < prev.maxPurchasesPerDay,
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuying(false);
    }
  }

  const win = !!result && result.reward > 0;
  // 当たり時は該当リールを光らせる。チェリー小役はチェリーの位置だけ光らせる。
  const highlightIndex = (i: number): boolean => {
    if (!result || !win) return false;
    if (result.outcome === 'CHERRY_SINGLE') return result.reels[i] === 'CHERRY';
    return true;
  };

  return (
    <div>
      {/* ヘッダー */}
      <div className={`relative mb-6 overflow-hidden rounded-2xl border-2 p-6 ${ts.header}`}>
        {isHalloween ? (
          <span
            className="animate-halloween-float pointer-events-none absolute right-3 top-2 text-4xl"
            aria-hidden
          >
            👻
          </span>
        ) : null}
        <h1 className="text-2xl font-bold">
          {isHalloween ? '🎃 ' : ''}
          {def.title}
        </h1>
        <p className="mt-1 text-sm text-white/85">
          {def.tagline}{' '}
          <span className="font-bold text-amber-200">{initial.maxPayout} Pui</span>
        </p>
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="rounded-full bg-white/15 px-3 py-1">
            {promoActive ? (
              <>
                本日残り <span className="font-bold">∞</span> 回{' '}
                <span className="ml-1 rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-bold text-amber-950">
                  DEMO
                </span>
              </>
            ) : (
              <>
                本日残り <span className="font-bold">{remaining}</span> / {maxPerDay} 回
              </>
            )}
          </span>
          <span className="rounded-full bg-white/15 px-3 py-1">
            保有 Pui <span className="font-bold text-amber-300">{balance.toLocaleString()}</span>
          </span>
        </div>
      </div>

      {/* 筐体 */}
      <div className={`relative overflow-hidden rounded-2xl border-2 p-5 ${ts.cabinet}`}>
        {isHalloween ? <HalloweenDecorations /> : null}
        <div className="relative mt-2 flex items-center justify-center gap-2 sm:gap-3">
          {[0, 1, 2].map((i) => (
            <SlotReel
              key={i}
              symbol={reels[i]}
              spinning={spinning[i]}
              fast={fastSpin}
              highlight={highlightIndex(i)}
              theme={theme}
            />
          ))}
        </div>

        {/* 結果表示 (全リール停止後) */}
        <div className="relative mt-4 min-h-[64px] text-center" aria-live="polite">
          {isSpinning ? (
            <p className="text-sm font-medium text-white/60">{def.spinningMessage}</p>
          ) : result ? (
            win ? (
              <div className="animate-acchi-pop">
                <p className={`text-lg font-bold ${ts.winTitle}`}>
                  {def.outcomeLabel[result.outcome]}
                  {def.winSuffix}
                </p>
                <p className={`mt-1 inline-block rounded-full px-4 py-1.5 font-bold ${ts.winBadge}`}>
                  +{result.reward} Pui 獲得！
                </p>
              </div>
            ) : (
              <div>
                <p className="text-lg font-bold text-white/70">{def.loseTitle}</p>
                <p className="mt-1 text-sm text-white/50">{def.loseMessage}</p>
              </div>
            )
          ) : (
            <p className="text-sm text-white/60">{def.idleMessage}</p>
          )}
        </div>

        {/* レバー */}
        <div className="relative mt-2 flex flex-col items-center gap-2">
          {canPlay ? (
            <Button
              onClick={spin}
              variant="primary"
              size="lg"
              disabled={isSpinning}
              className={`w-full max-w-xs ${ts.lever}`}
            >
              {isSpinning ? '回転中…' : result ? 'もう一度回す' : 'レバーを押す'}
            </Button>
          ) : (
            <p className="rounded-lg bg-white/10 px-4 py-3 text-center text-sm font-medium text-white/80">
              本日のプレイは終了しました。また明日！
            </p>
          )}
        </div>
      </div>

      {/* 追加プレイ購入 */}
      {!promoActive ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-sm text-slate-600">
            もっと遊びたい？ <span className="font-bold">{extraPlay.costPui} Pui</span>{' '}
            で本日の回数を 1 回追加できます。
          </p>
          <p className="mt-1 text-xs text-slate-400">
            本日の購入 {extraPlay.purchasedToday} / {extraPlay.maxPurchasesPerDay} 回
          </p>
          <div className="mt-3">
            <Button
              onClick={buyExtraPlay}
              variant="outline"
              size="md"
              disabled={!extraPlay.canBuyMore || buying || isSpinning || balance < extraPlay.costPui}
              loading={buying}
            >
              {extraPlay.canBuyMore
                ? `${extraPlay.costPui} Pui で 1 回追加`
                : '本日の購入上限に達しました'}
            </Button>
          </div>
          {extraPlay.canBuyMore && balance < extraPlay.costPui ? (
            <p className="mt-2 text-xs text-rose-500">Pui が足りません</p>
          ) : null}
        </div>
      ) : null}

      {/* 配当表 */}
      <div className={`mt-4 rounded-2xl border p-4 shadow-sm ${ts.card}`}>
        <h2 className={`mb-2 text-sm font-bold ${ts.cardTitle}`}>
          {isHalloween ? '🎃 配当表' : '配当表'}
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400">
              <th className="pb-1 font-medium">絵柄</th>
              <th className="pb-1 font-medium">役</th>
              <th className="pb-1 text-right font-medium">獲得 Pui</th>
            </tr>
          </thead>
          <tbody>
            {PAYOUT_ROWS.map((o) => (
              <tr key={o} className="border-t border-slate-100">
                <td className="whitespace-nowrap py-1.5 pr-2 text-lg">{outcomeSymbols(o, def)}</td>
                <td className="py-1.5 text-slate-600">{def.outcomeLabel[o]}</td>
                <td className="py-1.5 text-right font-bold text-slate-800">
                  {initial.payouts[o]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          ※ 表示は基本配当です。ご加入のプランに応じた Pui 付与率が適用されるため、実際の獲得数は
          これより多くなる場合があります。
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          ※ 絵柄:{' '}
          {SLOT_SYMBOLS.map((s) => `${def.symbolEmoji[s]}${def.symbolLabel[s]}`).join(' / ')}
        </p>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-center text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="mt-6 text-center">
        <Button onClick={() => router.push('/game')} variant="secondary" size="md">
          ゲーム一覧に戻る
        </Button>
      </div>
    </div>
  );
}
