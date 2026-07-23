'use client';

/**
 * あっちむいてPUI ミニゲーム (クライアント UI)。
 *
 * 重要: このコンポーネントは「演出」のみを担当する。
 * 勝敗・CPU の方向・Pui 付与はすべてサーバー (POST /api/me/games/acchi) が確定する。
 * 送信するのはプレイヤーが指した「方向」だけ。
 *
 * === ルール (方向対決 1 ラウンドのみ) ===
 *  指した方向と向いた方向が一致すれば勝ち、不一致なら負け。
 *
 * フロー (UI):
 *  1. スタート: タップしてゲーム開始 (voiceStart)。
 *  2. 方向選択: 中央のトリガーをつまんで、指したい方向へドラッグして離す
 *     (ゲームコントローラーのトリガーを引くような操作感。タッチ/マウス両対応)。
 *     離した瞬間に API を 1 回叩き、サーバーが方向対決を解決して返す。
 *  3. 決着演出: 一致/不一致を演出 → 「結果を確認」ボタンで結果表示へ。
 *  4. 結果表示 → もう一度 / 終了。
 *
 * 演出: REIRIE キャラクター (CharacterAvatar) が
 *   待機 → あっちむいてPUIで横顔
 * とアニメーションで動く。キャラ画像の差し替えは ./character.ts 参照。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CHARACTER_IMAGE_VARIANTS,
  type AcchiDirection,
  type AcchiVoiceUrlMap,
  type CharacterImageUrlMap,
} from '@idol/shared';
import { Button } from '@/components/ui/Button';
import { CharacterAvatar } from './CharacterAvatar';
import { CHARACTER_NAME, DIRECTION_POSE, type CharacterPose } from './character';
import { DirectionTrigger } from './DirectionTrigger';
import { useAcchiSound } from './useAcchiSound';

type Initial = {
  date: string;
  maxPerDay: number;
  winReward: number;
  playedToday: number;
  remaining: number;
  /** プロモ/デモアカウントで、プレイ回数が無制限のとき true。 */
  promoActive?: boolean;
  balance: number;
};

/** 方向対決の結果。 */
type DirectionResult = {
  player: AcchiDirection;
  cpu: AcchiDirection;
  matched: boolean;
};

type PlayResponse = {
  direction: DirectionResult;
  result: 'WIN' | 'LOSE';
  reward: number;
  balance: number;
  playedToday: number;
  remaining: number;
};

const DIR_EMOJI: Record<AcchiDirection, string> = {
  UP: '☝️',
  DOWN: '👇',
  LEFT: '👈',
  RIGHT: '👉',
};
const DIR_LABEL: Record<AcchiDirection, string> = {
  UP: '上',
  DOWN: '下',
  LEFT: '左',
  RIGHT: '右',
};

// フロー:
//  start     … タップしてスタート (voiceStart)
//  direction … トリガーをつまんで方向を選び、離すと確定 → API 送信 (voiceAcchi)
//  reveal    … 方向対決の一致/不一致を演出 → 「結果を確認」で result へ。
//  result    … 最終結果。
type Phase = 'start' | 'direction' | 'reveal' | 'result';

export function AcchiGameClient({
  initial,
  voiceUrls = {},
  characterImageUrls = {},
}: {
  initial: Initial;
  voiceUrls?: AcchiVoiceUrlMap;
  /** 管理画面でアップロードされたポーズ別キャラクター画像 URL マップ (任意)。 */
  characterImageUrls?: CharacterImageUrlMap;
}) {
  const router = useRouter();
  const sound = useAcchiSound(voiceUrls);
  const [remaining, setRemaining] = useState(initial.remaining);
  const [promoActive, setPromoActive] = useState(initial.promoActive ?? false);
  const [balance, setBalance] = useState(initial.balance);
  // 最初は「タップしてスタート」画面。ここでの最初のタップで voiceStart を鳴らし、
  // 以降のボイスも自動再生ブロックされないようにする (ブラウザの自動再生ポリシー対策)。
  const [phase, setPhase] = useState<Phase>('start');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PlayResponse | null>(null);
  // reveal フェーズで「結果を表示し、ユーザーの操作 (ボタン) 待ち」の状態か。
  const [awaitingAction, setAwaitingAction] = useState(false);

  // このプレイで使うキャラ画像のパターン番号。プレイごとに 1 度だけ抽選し、
  // 全ポーズで同じ番号を優先的に使う (= 途中でパターンが混ざらない)。
  // 実際に登録されているパターン番号の中から選ぶ (未登録番号を選んでも無意味なため)。
  const pickImageVariant = useCallback((): number => {
    const available = new Set<number>();
    for (const v of Object.values(characterImageUrls)) {
      if (!v) continue;
      for (const key of Object.keys(v)) {
        const n = Number(key);
        if (CHARACTER_IMAGE_VARIANTS.includes(n)) available.add(n);
      }
    }
    const list = [...available].sort((a, b) => a - b);
    if (list.length === 0) return 1; // 未登録なら 1 (SVG フォールバックになるだけ)
    return list[Math.floor(Math.random() * list.length)];
  }, [characterImageUrls]);

  const [imageVariant, setImageVariant] = useState<number>(() => pickImageVariant());

  // 二重送信 (連打・ダブルタップ) の同期ガード。
  // `loading` (state) は setState が非同期のため、極短時間の連打では
  // 2 回目の onClick が「まだ loading=false」を見て通過し、POST が二重に
  // 飛ぶ可能性がある。ref は同期的に更新できるため、確実に 1 回に絞れる。
  const submittingRef = useRef(false);
  // 「もう一度」「会員カードに戻る」押下後、またね音声を鳴らし切るまでの遷移待ちフラグ。
  // 二重押しを防ぎ、ボタンを無効化 (disabled) して連打で音が途切れないようにする。
  const transitioningRef = useRef(false);
  const [transitioning, setTransitioning] = useState(false);

  const canPlay = remaining > 0;

  // === 音声フロー ===
  // 0. サムネから来る → 「タップしてスタート」画面。最初のタップで開始音声 (voiceStart)
  //    を鳴らしてから 方向選択画面へ (自動再生ポリシー対策)。
  // 1. 方向選択 → トリガーを離した瞬間に掛け声 (voiceAcchi) → API 送信 → 演出へ。
  // 2. 演出 (reveal):
  //      方向一致 (プレイヤー勝ち) → win + voiceWin → 「結果を確認」ボタン待ち → 結果へ
  //      方向不一致 (プレイヤー負け) → lose + voiceLose → 「結果を確認」ボタン待ち → 結果へ
  // 3. 結果 (result): 勝利時のみ Pui 獲得音 (point)。
  //      もう一度 → もう一戦を促す音声 (voiceAgain) → スタート画面へ
  //      終了     → またね音声 (voiceBye) → 会員カードへ

  // reveal フェーズに入ったら、一致/不一致の勝敗音声を鳴らして
  // 「結果を確認」ボタン待ちにする。
  useEffect(() => {
    if (phase !== 'reveal' || !outcome) return;

    if (outcome.direction.matched) {
      // 方向一致 = プレイヤーの勝ち = REIRIE の負け
      sound.play('win');
      sound.play('voiceWin');
    } else {
      // 方向不一致 = プレイヤーの負け = REIRIE の勝ち
      sound.play('lose');
      sound.play('voiceLose');
    }
    setAwaitingAction(true);
  }, [phase, outcome, sound]);

  // 結果フェーズに入ったら、勝利報酬の Pui 獲得音のみ鳴らす。
  // 勝敗ボイス/効果音は reveal フェーズで既に再生済み。
  useEffect(() => {
    if (phase !== 'result' || !outcome) return;
    if (outcome.result === 'WIN' && outcome.reward > 0) {
      const t = setTimeout(() => sound.play('point'), 300);
      return () => clearTimeout(t);
    }
  }, [phase, outcome, sound]);

  // 「タップしてスタート」= 最初のユーザー操作。ここで開始音声を鳴らし、
  // 以降のボイスが自動再生ブロックされないようにしてから 方向選択画面へ。
  function startGame() {
    if (!canPlay) return;
    sound.play('tap');
    sound.play('voiceStart');
    setError(null);
    setPhase('direction');
  }

  // 【方向選択】トリガーで方向を選んで離す → サーバーが方向対決を確定
  // (プレイ回数消費・Pui 付与も同時に行われる)。
  async function selectDirection(dir: AcchiDirection) {
    // 二重送信ガード (ref を同期チェック)。
    if (!canPlay || loading || submittingRef.current) return;
    submittingRef.current = true;
    // トリガーを引いた瞬間に「あっちむいて…PU！」の掛け声を鳴らす。
    sound.play('tap');
    sound.play('voiceAcchi');
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/me/games/acchi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: dir }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'プレイに失敗しました');
      }
      const data = json as PlayResponse;
      setOutcome(data);
      setRemaining(data.remaining);
      setBalance(data.balance);
      setAwaitingAction(false);
      setPhase('reveal');
    } catch (e) {
      setError((e as Error).message);
      setPhase('direction');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  // reveal (結果表示後) → 「結果を確認」ボタン。
  // 結果画面へ進む。押した瞬間に、この後のプレイ状況に応じたボイスを鳴らす:
  //  - まだ本日のプレイ回数が残っている (or プレミアム無制限) → 「もう一回」系 (voiceAgain)
  //  - 本日のプレイが終了 → 「またね (また明日)」系 (voiceBye)
  // ボイスが未アップロードのスロットは黙ってスキップされる。
  function goToResult() {
    const canPlayMore = promoActive || remaining > 0;
    sound.play(canPlayMore ? 'voiceAgain' : 'voiceBye');
    setAwaitingAction(false);
    setPhase('result');
  }

  async function playAgain() {
    // もう一度 → 「もう一戦を促す」音声 (voiceAgain) を「鳴らし切ってから」スタート画面に戻す。
    // 遷移中フラグ (transitioningRef) で二重押しを防止し、音声が途切れないようにする。
    // voiceAgain が未アップロードなら playToEnd は即解決するので、そのまま次へ進む。
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    setTransitioning(true);
    await sound.playToEnd('voiceAgain');
    setOutcome(null);
    setError(null);
    setAwaitingAction(false);
    // 次のプレイのパターン番号を抽選し直す (プレイごとに見た目が変わる)。
    setImageVariant(pickImageVariant());
    // スタート画面に戻す (最初のタップで開始音声を鳴らすフローを再現)。
    setPhase('start');
    transitioningRef.current = false;
    setTransitioning(false);
  }

  async function endGame() {
    // 終了 → またね音声を「鳴らし切ってから」ホーム (会員カード) に戻る。
    // router.push を即実行するとページ遷移で音声が途切れるため、
    // playToEnd の Promise (再生終了 or 保険タイムアウトで解決) を待ってから遷移する。
    // ミュート / 未アップロード / 再生ブロック時は即解決するので固まらない。
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    setTransitioning(true);
    await sound.playToEnd('voiceBye');
    router.push('/me/card');
  }

  return (
    <div>
      {/* ヘッダー */}
      <div className="mb-6 rounded-2xl border-2 border-black bg-twilight-rose p-6 text-white shadow-[6px_6px_0_rgba(0,0,0,0.9)]">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold">あっちむいてPUI</h1>
          {/* 音声 ON/OFF 切り替え */}
          <button
            type="button"
            onClick={sound.toggleMute}
            aria-pressed={sound.muted}
            aria-label={sound.muted ? '音声をオンにする' : '音声をオフにする'}
            title={sound.muted ? '音声をオンにする' : '音声をオフにする'}
            className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-lg transition hover:bg-white/25 active:scale-95"
          >
            {sound.muted ? '🔇' : '🔊'}
          </button>
        </div>
        <p className="mt-1 text-sm text-white/80">
          {CHARACTER_NAME} と勝負！勝てば{' '}
          <span className="font-bold text-amber-300">{initial.winReward} Pui</span> ゲット！
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
                本日残り <span className="font-bold">{remaining}</span> / {initial.maxPerDay} 回
              </>
            )}
          </span>
          <span className="rounded-full bg-white/15 px-3 py-1">
            保有 Pui <span className="font-bold text-amber-300">{balance.toLocaleString()}</span>
          </span>
        </div>
      </div>

      {/* 上限到達 */}
      {!canPlay && phase !== 'result' ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="text-3xl">🌙</p>
          <p className="mt-2 font-bold text-amber-900">本日のプレイは終了しました</p>
          <p className="mt-1 text-sm text-amber-800">
            また明日 {initial.maxPerDay} 回チャレンジできます。お楽しみに！
          </p>
        </div>
      ) : null}

      {/* スタート画面 (タップしてスタート) — 最初のタップで開始音声を鳴らす */}
      {phase === 'start' && canPlay ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          {/* キャラクター (待機で揺れる) */}
          <div className="animate-acchi-swing">
            <CharacterAvatar pose="idle" imageUrls={characterImageUrls} variant={imageVariant} bob />
          </div>
          <p className="mb-1 mt-2 text-lg font-bold text-slate-800">
            {CHARACTER_NAME} とあっちむいてPUI！
          </p>
          <p className="mb-6 text-sm text-slate-500">
            方向を当てたらキミの勝ち！勝てば{' '}
            <span className="font-bold text-amber-600">{initial.winReward} Pui</span> ゲット！
          </p>
          <Button onClick={startGame} variant="primary" size="lg">
            タップしてスタート
          </Button>
        </div>
      ) : null}

      {/* 方向選択フェーズ (トリガーをつまんでドラッグ → 離して確定) */}
      {phase === 'direction' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {/* キャラクター (待機で揺れる) */}
          <div className="animate-acchi-swing">
            <CharacterAvatar pose="idle" imageUrls={characterImageUrls} variant={imageVariant} bob />
          </div>
          <p className="mb-1 mt-2 text-lg font-bold text-slate-800">あっちむいて… PU！</p>
          <p className="mb-4 text-xs text-slate-400">
            中央のトリガーをつまんで、指したい方向へ引いてね。{CHARACTER_NAME} が同じ方向を向いたら あなたの勝ち！
          </p>
          <DirectionTrigger onSelect={selectDirection} disabled={loading} />
          {loading ? <p className="mt-4 text-sm text-slate-400">あっちむいて…PU！</p> : null}
        </div>
      ) : null}

      {/* 決着演出フェーズ (方向対決の一致/不一致) */}
      {phase === 'reveal' && outcome ? (
        <RevealCard
          outcome={outcome}
          awaitingAction={awaitingAction}
          onConfirmResult={goToResult}
          characterImageUrls={characterImageUrls}
          imageVariant={imageVariant}
        />
      ) : null}

      {/* 結果フェーズ */}
      {phase === 'result' && outcome ? (
        <ResultCard
          outcome={outcome}
          canPlay={remaining > 0}
          promoActive={promoActive}
          onAgain={playAgain}
          onBack={endGame}
          busy={transitioning}
          characterImageUrls={characterImageUrls}
          imageVariant={imageVariant}
        />
      ) : null}

      {error ? (
        <p className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-center text-sm text-rose-700">{error}</p>
      ) : null}
    </div>
  );
}

/**
 * 方向対決の決着 (一致/不一致) を演出するカード。
 */
function RevealCard({
  outcome,
  awaitingAction,
  onConfirmResult,
  characterImageUrls,
  imageVariant,
}: {
  outcome: PlayResponse;
  /** 結果を表示し、ユーザーのボタン操作待ちか。 */
  awaitingAction: boolean;
  /** 「結果を確認」ボタン。 */
  onConfirmResult: () => void;
  characterImageUrls?: CharacterImageUrlMap;
  imageVariant: number;
}) {
  const { direction } = outcome;
  const cpuPose: CharacterPose = DIRECTION_POSE[direction.cpu];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <div key={cpuPose} className="animate-acchi-turn">
        <CharacterAvatar pose={cpuPose} imageUrls={characterImageUrls} variant={imageVariant} bob={false} />
      </div>
      <p className="mt-3 text-sm text-slate-500">
        あなたが「{DIR_LABEL[direction.player]}」を指す → {CHARACTER_NAME} は「
        {DIR_LABEL[direction.cpu]}」を向いた！
      </p>
      <p className="mt-2 text-xl font-bold text-slate-800">
        {direction.matched ? '方向が一致…！' : '方向が外れた…！'}
      </p>

      {/* 結果表示後 → 「結果を確認」ボタンで結果画面へ */}
      {awaitingAction ? (
        <div className="mt-5">
          <Button onClick={onConfirmResult} variant="primary" size="lg">
            結果を確認
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ResultCard({
  outcome,
  canPlay,
  promoActive,
  onAgain,
  onBack,
  busy,
  characterImageUrls,
  imageVariant,
}: {
  outcome: PlayResponse;
  canPlay: boolean;
  promoActive: boolean;
  onAgain: () => void;
  onBack: () => void;
  /** またね音声の再生待ち中か (true の間はボタンを無効化して連打/音切れを防ぐ)。 */
  busy: boolean;
  characterImageUrls?: CharacterImageUrlMap;
  imageVariant: number;
}) {
  const win = outcome.result === 'WIN';
  const theme = win
    ? { bg: 'from-amber-50 to-yellow-100 border-amber-200', emoji: '🎉', label: 'あなたの勝ち！', color: 'text-amber-900' }
    : { bg: 'from-rose-50 to-red-100 border-rose-200', emoji: '😢', label: 'あなたの負け…', color: 'text-rose-900' };

  const { direction } = outcome;
  const cpuPose: CharacterPose = DIRECTION_POSE[direction.cpu];

  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${theme.bg} p-6 text-center shadow-sm`}>
      {/* REIRIE の演出 */}
      <div key={cpuPose} className="animate-acchi-turn">
        <CharacterAvatar pose={cpuPose} imageUrls={characterImageUrls} variant={imageVariant} bob={false} />
      </div>
      <p className="text-xs text-slate-400">
        あなたが「{DIR_LABEL[direction.player]}」を指す → {CHARACTER_NAME} は「
        {DIR_LABEL[direction.cpu]}」を向いた！
      </p>

      <p className="mt-3 text-4xl animate-acchi-pop">{theme.emoji}</p>
      <p className={`mt-1 text-2xl font-bold ${theme.color}`}>{theme.label}</p>

      {/* 対戦内容 */}
      <div className="mt-5 flex items-center justify-center gap-6 text-sm text-slate-600">
        <div>
          <p className="mb-1 text-xs text-slate-400">あなた</p>
          <p className="text-3xl">{DIR_EMOJI[direction.player]}</p>
          <p className="text-[11px] text-slate-400">{DIR_LABEL[direction.player]}</p>
        </div>
        <p className="text-lg font-bold text-slate-400">VS</p>
        <div>
          <p className="mb-1 text-xs text-slate-400">{CHARACTER_NAME}</p>
          <p className="text-3xl">{DIR_EMOJI[direction.cpu]}</p>
          <p className="text-[11px] text-slate-400">{DIR_LABEL[direction.cpu]}</p>
        </div>
      </div>

      {win ? (
        <p className="mt-4 rounded-full bg-amber-200 px-4 py-2 font-bold text-amber-900">
          +{outcome.reward} Pui 獲得！ (残高 {outcome.balance.toLocaleString()} Pui)
        </p>
      ) : (
        <p className="mt-4 text-sm text-slate-500">残高 {outcome.balance.toLocaleString()} Pui</p>
      )}

      <p className="mt-3 text-xs text-slate-400">
        本日残り {promoActive ? '∞' : outcome.remaining} 回
      </p>

      <div className="mt-5 flex flex-col gap-2">
        {canPlay ? (
          <Button onClick={onAgain} variant="primary" size="lg" disabled={busy}>
            もう一度遊ぶ
          </Button>
        ) : (
          <p className="text-sm font-medium text-slate-500">本日のプレイは終了しました。また明日！</p>
        )}
        <Button onClick={onBack} variant="secondary" size="md" disabled={busy}>
          {busy ? '…' : '会員カードに戻る'}
        </Button>
      </div>
    </div>
  );
}
