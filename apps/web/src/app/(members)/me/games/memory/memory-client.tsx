'use client';

/**
 * PUI メモリー (神経衰弱) — クライアント UI。
 *
 * 【重要】このコンポーネントは「表示」だけを担当する。
 * 盤面の中身・一致判定・獲得 Pui はすべてサーバーが確定する。
 * クライアントは「この位置をめくる」というリクエストしか送らない。
 * → クライアント側を改造しても不正に Pui を得ることはできない。
 *
 * 【未めくりカードには写真が入っていない】
 * API は未めくりカードの photo を返さないため、
 * DevTools でレスポンスを覗いても盤面は分からない。
 * この UI も「渡された写真を描画する」だけで、
 * 位置を推測するための情報を一切持たない。
 *
 * 【外れたときの見せ方】
 * 2 枚目が外れた場合、サーバーはその 2 枚を «表» として返す。
 * ここで一定時間表示してから裏に戻す (どのカードだったか分からないと
 * 記憶ゲームにならない)。裏に戻すのは表示だけで、
 * サーバー側ではすでに firstPick が解除されている。
 *
 * 【コピー対策】
 * ギャラリー (ask#60) と同じ方針で、右クリック・ドラッグ・長押しを抑制する。
 * ブラウザのスクリーンショットは防げないため «完全な対策ではない» が、
 * 気軽な保存・転載のハードルは上げられる。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

type Rules = {
  pairCount: number;
  maxMoves: number;
  maxPlaysPerDay: number;
  pairReward: number;
  clearBonus: number;
  maxReward: number;
};

type Photo = { id: string; url: string; caption?: string | null };

type CardView = {
  index: number;
  faceUp: boolean;
  matched: boolean;
  photo?: Photo;
};

type GameStatus = 'PLAYING' | 'CLEARED' | 'FAILED';

type Initial = {
  date: string;
  maxPerDay: number;
  playedToday: number;
  remaining: number;
  promoActive?: boolean;
  balance: number;
  rules: Rules;
};

type StartResponse = {
  cards: CardView[];
  status: GameStatus;
  matchedPairs: number;
  moves: number;
  remainingMoves: number;
  awaitingSecond: boolean;
  resumed?: boolean;
  playedToday?: number;
  remaining?: number;
  rules: Rules;
};

type FlipResponse = {
  outcome: 'FIRST' | 'MATCH' | 'MISS';
  cards: CardView[];
  revealed?: number[];
  inProgress: boolean;
  status: GameStatus;
  matchedPairs: number;
  moves: number;
  remainingMoves: number;
  awaitingSecond: boolean;
  reward?: number;
  balance?: number;
  playedToday?: number;
  remaining?: number;
};

/** 外れた 2 枚を見せておく時間 (ms) */
const MISS_REVEAL_MS = 1100;

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      'エラーが発生しました';
    throw new Error(msg);
  }
  return data as T;
}

export function MemoryGameClient({ initial }: { initial: Initial }) {
  const router = useRouter();
  const rules = initial.rules;

  const [cards, setCards] = useState<CardView[]>([]);
  const [inProgress, setInProgress] = useState(false);
  const [status, setStatus] = useState<GameStatus>('PLAYING');
  const [matchedPairs, setMatchedPairs] = useState(0);
  const [moves, setMoves] = useState(0);
  const [remainingMoves, setRemainingMoves] = useState(rules.maxMoves);
  const [balance, setBalance] = useState(initial.balance);
  const [playedToday, setPlayedToday] = useState(initial.playedToday);
  const [remaining, setRemaining] = useState(initial.remaining);
  const [reward, setReward] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 揃った瞬間に大きく見せる写真 */
  const [showcase, setShowcase] = useState<Photo | null>(null);

  /** 外れ表示のタイマー。アンマウント時に解除する */
  const missTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (missTimer.current) clearTimeout(missTimer.current);
    },
    [],
  );

  /** 進行中のゲームがあれば復帰する (リロードしても続きから遊べる) */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/me/games/memory');
        if (!res.ok) return;
        const data = (await res.json()) as {
          inProgress?: boolean;
          cards?: CardView[];
          status?: GameStatus;
          matchedPairs?: number;
          moves?: number;
          remainingMoves?: number;
          balance?: number;
          playedToday?: number;
          remaining?: number;
        };
        if (cancelled || !data.inProgress || !data.cards) return;
        setCards(data.cards);
        setInProgress(true);
        setStatus(data.status ?? 'PLAYING');
        setMatchedPairs(data.matchedPairs ?? 0);
        setMoves(data.moves ?? 0);
        setRemainingMoves(data.remainingMoves ?? rules.maxMoves);
        if (typeof data.balance === 'number') setBalance(data.balance);
        if (typeof data.playedToday === 'number') setPlayedToday(data.playedToday);
        if (typeof data.remaining === 'number') setRemaining(data.remaining);
      } catch {
        // 復帰は «できたら嬉しい» 機能。失敗しても «新しく始める» から遊べる。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rules.maxMoves]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    setReward(null);
    setShowcase(null);
    try {
      const data = await postJson<StartResponse>('/api/me/games/memory/start');
      setCards(data.cards);
      setInProgress(true);
      setStatus(data.status);
      setMatchedPairs(data.matchedPairs);
      setMoves(data.moves);
      setRemainingMoves(data.remainingMoves);
      if (typeof data.playedToday === 'number') setPlayedToday(data.playedToday);
      if (typeof data.remaining === 'number') setRemaining(data.remaining);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ゲームを開始できませんでした');
    } finally {
      setBusy(false);
    }
  }, []);

  const flip = useCallback(
    async (index: number) => {
      // 二重タップ・外れ表示中の操作を防ぐ
      if (busy || !inProgress) return;
      const card = cards[index];
      if (!card || card.matched || card.faceUp) return;

      setBusy(true);
      setError(null);
      try {
        const data = await postJson<FlipResponse>('/api/me/games/memory/flip', {
          index,
        });
        setCards(data.cards);
        setMatchedPairs(data.matchedPairs);
        setMoves(data.moves);
        setRemainingMoves(data.remainingMoves);
        setStatus(data.status);

        if (data.outcome === 'MATCH') {
          // 揃った写真を大きく見せる (このゲームのご褒美)
          const photo = data.cards.find((c) => c.index === index)?.photo ?? null;
          setShowcase(photo);
        }

        if (data.outcome === 'MISS') {
          /**
           * 外れた 2 枚を一定時間見せてから裏に戻す。
           * サーバー側では既に firstPick が解除されているので、
           * ここでの «裏に戻す» は表示上の処理のみ。
           */
          const revealed = data.revealed ?? [];
          missTimer.current = setTimeout(() => {
            setCards((prev) =>
              prev.map((c) =>
                revealed.includes(c.index) && !c.matched
                  ? { ...c, faceUp: false, photo: undefined }
                  : c,
              ),
            );
            setBusy(false);
          }, MISS_REVEAL_MS);
        }

        if (!data.inProgress) {
          setInProgress(false);
          if (typeof data.reward === 'number') setReward(data.reward);
          if (typeof data.balance === 'number') setBalance(data.balance);
          if (typeof data.playedToday === 'number') setPlayedToday(data.playedToday);
          if (typeof data.remaining === 'number') setRemaining(data.remaining);
          // ヘッダーの Pui 残高を更新する
          router.refresh();
        }

        // MISS はタイマー内で解除するので、それ以外だけここで解除
        if (data.outcome !== 'MISS') setBusy(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'めくれませんでした');
        setBusy(false);
      }
    },
    [busy, cards, inProgress, router],
  );

  const giveUp = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<FlipResponse>('/api/me/games/memory/giveup');
      setInProgress(false);
      setStatus(data.status);
      if (typeof data.reward === 'number') setReward(data.reward);
      if (typeof data.balance === 'number') setBalance(data.balance);
      if (typeof data.playedToday === 'number') setPlayedToday(data.playedToday);
      if (typeof data.remaining === 'number') setRemaining(data.remaining);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '終了できませんでした');
    } finally {
      setBusy(false);
    }
  }, [busy, router]);

  const canPlay = initial.promoActive || remaining > 0;

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-bold text-slate-900">🃏 PUI メモリー</h1>
        <p className="mt-1 text-sm text-slate-500">
          同じ写真のペアを揃えると Pui がもらえます。
          {rules.maxMoves} 手以内に全 {rules.pairCount} ペア揃えるとボーナス！
        </p>
      </header>

      {/* ステータス */}
      <dl className="mb-4 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-white p-3 text-center">
        <div>
          <dt className="text-[11px] text-slate-500">残りプレイ</dt>
          <dd className="text-base font-bold text-slate-900">
            {initial.promoActive ? '∞' : `${remaining} / ${rules.maxPlaysPerDay}`}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">残り手数</dt>
          <dd className="text-base font-bold text-slate-900">
            {inProgress ? remainingMoves : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Pui 残高</dt>
          <dd className="text-base font-bold text-pink-600">
            {balance.toLocaleString()}
          </dd>
        </div>
      </dl>

      {error && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {error}
        </p>
      )}

      {/* 盤面 */}
      {cards.length > 0 && (
        <div
          className="grid select-none grid-cols-4 gap-2"
          // コピー対策: 右クリック / 長押しメニューを抑制する
          // (完全な対策ではないが、気軽な保存のハードルは上げられる)
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        >
          {cards.map((c) => (
            <button
              key={c.index}
              type="button"
              onClick={() => flip(c.index)}
              disabled={!inProgress || busy || c.faceUp || c.matched}
              aria-label={
                c.matched
                  ? `${c.index + 1}番目のカード (ペア成立)`
                  : c.faceUp
                    ? `${c.index + 1}番目のカード (めくり中)`
                    : `${c.index + 1}番目のカード (裏)`
              }
              className={[
                'relative aspect-square overflow-hidden rounded-lg border-2 transition',
                c.matched
                  ? 'border-pink-400 opacity-80'
                  : c.faceUp
                    ? 'border-pink-300'
                    : 'border-slate-200 bg-gradient-to-br from-pink-100 to-purple-100 hover:from-pink-200 hover:to-purple-200',
                !inProgress || busy ? 'cursor-default' : 'cursor-pointer',
              ].join(' ')}
            >
              {c.faceUp && c.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.photo.url}
                  alt={c.photo.caption ?? ''}
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  onContextMenu={(e) => e.preventDefault()}
                  className="h-full w-full select-none object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xl">
                  {c.faceUp ? '🃏' : '💗'}
                </span>
              )}
              {c.matched && (
                <span className="absolute right-1 top-1 rounded-full bg-pink-500 px-1.5 text-[10px] font-bold text-white">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 揃った写真をご褒美として大きく見せる */}
      {showcase && (
        <div
          className="mt-4 overflow-hidden rounded-lg border border-pink-200 bg-pink-50 p-3"
          onContextMenu={(e) => e.preventDefault()}
        >
          <p className="mb-2 text-center text-sm font-bold text-pink-700">
            ペア成立！ +{rules.pairReward} Pui
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={showcase.url}
            alt={showcase.caption ?? ''}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            className="mx-auto max-h-56 select-none rounded object-contain"
          />
          {showcase.caption && (
            <p className="mt-2 text-center text-xs text-slate-600">{showcase.caption}</p>
          )}
        </div>
      )}

      {/* 進行 / 結果 */}
      <div className="mt-5">
        {inProgress ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {matchedPairs} / {rules.pairCount} ペア・{moves} 手
            </p>
            <button
              type="button"
              onClick={giveUp}
              disabled={busy}
              className="text-xs text-slate-500 underline hover:text-slate-700"
            >
              ここでやめる（揃えたぶんの Pui はもらえます）
            </button>
          </div>
        ) : (
          <div className="text-center">
            {reward !== null && (
              <div className="mb-3 rounded-lg border border-pink-200 bg-pink-50 px-4 py-3">
                <p className="text-sm font-bold text-pink-700">
                  {status === 'CLEARED'
                    ? `🎉 全ペア達成！ +${reward} Pui`
                    : `${matchedPairs} ペア成立 +${reward} Pui`}
                </p>
                {status === 'CLEARED' && (
                  <p className="mt-1 text-xs text-pink-600">
                    クリアボーナス {rules.clearBonus} Pui を含みます
                  </p>
                )}
              </div>
            )}

            {canPlay ? (
              <Button onClick={start} disabled={busy}>
                {busy ? '準備中…' : cards.length > 0 ? 'もう一度あそぶ' : 'ゲームを始める'}
              </Button>
            ) : (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                本日のプレイ回数（{rules.maxPlaysPerDay} 回）を使い切りました。
                また明日挑戦してください。
              </p>
            )}
          </div>
        )}
      </div>

      {/* ルール */}
      <details className="mt-6 rounded-lg border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          あそびかた・もらえる Pui
        </summary>
        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600">
          <li>・カードを 2 枚めくって、同じ写真ならペア成立です。</li>
          <li>・ペア 1 組ごとに {rules.pairReward} Pui もらえます。</li>
          <li>
            ・{rules.maxMoves} 手以内に全 {rules.pairCount} ペア揃えると、さらに{' '}
            {rules.clearBonus} Pui のボーナス（最大 {rules.maxReward} Pui）。
          </li>
          <li>・1 日 {rules.maxPlaysPerDay} 回まであそべます。</li>
          <li>・途中でやめても、揃えたぶんの Pui はもらえます。</li>
          <li className="pt-1 text-slate-400">
            ※ カードの写真は、あなたが閲覧できるギャラリーの写真から選ばれます。
          </li>
        </ul>
      </details>

      <p className="mt-3 text-center text-[11px] text-slate-400">
        本日 {playedToday} 回プレイ
      </p>
    </div>
  );
}
