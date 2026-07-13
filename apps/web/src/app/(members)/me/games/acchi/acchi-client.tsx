'use client';

/**
 * あっちむいてPUI ミニゲーム (クライアント UI)。
 *
 * 重要: このコンポーネントは「演出」のみを担当する。
 * 勝敗・CPU の手/方向・ポイント付与はすべてサーバー (POST /api/me/games/acchi) が確定する。
 * 送信するのはプレイヤーの「手」と「方向」だけ。
 *
 * === ルール (2ラウンド制) ===
 *  ラウンド1 (じゃんけん): 負けたらその場でゲーム終了。あいこならもう一回。
 *                          勝ったらラウンド2へ進む。
 *  ラウンド2 (方向)     : 指した方向と向いた方向が一致すれば勝ち、不一致なら負け。
 *
 * フロー (UI):
 *  1. じゃんけん: 手を選ぶ (ローカル)。
 *  2. 方向選択: 上下左右を選ぶ → ここで API を 1 回叩き、サーバーが
 *     ラウンド1 (あいこによるやり直しを含む) とラウンド2 (進めた場合) を
 *     まとめて解決して返す。
 *  3. 決着演出: ラウンド1 の試行 (あいこ→やり直しを含む) を 1 つずつ
 *     アニメーション表示する。負けで終わった場合はここで結果表示へ。
 *     勝ってラウンド2 に進んだ場合は、方向の一致/不一致を演出してから結果表示へ。
 *  4. 結果表示 → もう一度 / 終了。
 *
 * これにより「サーバーが一括判定 (1 リクエスト)」を保ちつつ、
 * UI 上は「じゃんけんで負けたら即終了・あいこはやり直し・勝ったら方向対決」という
 * 2ラウンド制の見え方を実現する。
 *
 * 演出: REIRIE キャラクター (CharacterAvatar) が
 *   待機 → じゃんけんの手 → あっちむいてPUIで横顔
 * とアニメーションで動く。キャラ画像の差し替えは ./character.ts 参照。
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type JankenHand,
  type AcchiDirection,
  type AcchiVoiceUrlMap,
  type CharacterImageUrlMap,
} from '@idol/shared';
import { Button } from '@/components/ui/Button';
import { CharacterAvatar } from './CharacterAvatar';
import {
  CHARACTER_NAME,
  HAND_POSE,
  DIRECTION_POSE,
  type CharacterPose,
} from './character';
import { useAcchiSound } from './useAcchiSound';

type Initial = {
  date: string;
  maxPerDay: number;
  winReward: number;
  playedToday: number;
  remaining: number;
  balance: number;
};

type JankenOutcome = 'WIN' | 'LOSE' | 'DRAW';

/** ラウンド1 (じゃんけん) の 1 試行。 */
type Round1Attempt = {
  player: JankenHand;
  cpu: JankenHand;
  outcome: JankenOutcome;
};

/** ラウンド1 (じゃんけん) 全体の結果。 */
type Round1 = {
  attempts: Round1Attempt[];
  /** 'ADVANCE_TO_ROUND2' (勝ってラウンド2へ) | 'GAME_OVER' (負けて終了) */
  result: 'ADVANCE_TO_ROUND2' | 'GAME_OVER';
};

/** ラウンド2 (方向) の結果。ラウンド1で負けた場合は null。 */
type Round2 = {
  player: AcchiDirection;
  cpu: AcchiDirection;
  matched: boolean;
};

type PlayResponse = {
  janken: { player: JankenHand; cpu: JankenHand; outcome: JankenOutcome };
  direction: { player: AcchiDirection; cpu: AcchiDirection | null };
  result: 'WIN' | 'LOSE';
  reward: number;
  balance: number;
  playedToday: number;
  remaining: number;
  round1: Round1;
  round2: Round2 | null;
  /** 今回のプレイで付与された特典ポイント (勝利時、かつ本日上限内のみ > 0) */
  rewardPointBonus?: number;
  /** プレイ後の特典ポイント残高 */
  rewardPointBalance?: number;
};

const HAND_EMOJI: Record<JankenHand, string> = {
  ROCK: '✊',
  SCISSORS: '✌️',
  PAPER: '🖐️',
};
const HAND_LABEL: Record<JankenHand, string> = {
  ROCK: 'グー',
  SCISSORS: 'チョキ',
  PAPER: 'パー',
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

type Phase = 'janken' | 'direction' | 'reveal' | 'result';

/** ラウンド1 演出のサブフェーズ: 試行を1つずつ見せる → (進めば) ラウンド2 を見せる */
type RevealSubPhase = 'round1' | 'round2';

/** 各演出ステップの表示時間 (ms) */
const REVEAL_STEP_MS = 900;
const REVEAL_ROUND2_MS = 1100;

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
  const [balance, setBalance] = useState(initial.balance);
  const [phase, setPhase] = useState<Phase>('janken');
  const [hand, setHand] = useState<JankenHand | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PlayResponse | null>(null);
  const [revealIndex, setRevealIndex] = useState(0);
  const [revealSubPhase, setRevealSubPhase] = useState<RevealSubPhase>('round1');

  const canPlay = remaining > 0;

  // ミニゲームを開いた最初のユーザー操作でゲーム開始ボイスを鳴らすためのフラグ。
  // 自動再生ポリシー対策として、最初のタップ (手を選ぶ操作) の延長で再生する。
  const [startVoicePlayed, setStartVoicePlayed] = useState(false);

  // === 音声フロー ===
  // 1. ミニゲームを開く → ゲーム開始音声 (voiceStart)  ※最初の操作で再生
  // 2. じゃんけん → 結果表示 → じゃんけんの勝敗音声
  //      あいこ → もう一回 (voiceDraw)
  //      負け   → 終了 (lose + voiceLose)
  //      勝ち   → 勝ち音声 (win + voiceWin) → あっちむいてPU (voiceAcchi) で方向対決へ
  // 3. 方向選択 → 結果表示 → REIRIE の勝敗音声
  //      方向一致 = プレイヤーの勝ち → REIRIE 負け (win + voiceWin)
  //      方向不一致 = プレイヤーの負け → REIRIE 勝ち (lose + voiceLose)
  // 4. もう一度 / 終了 → またね音声 (voiceBye) → ホーム or 最初の画面へ

  // ラウンド1 の試行を 1 つずつ演出し、決着に応じて勝敗音声を鳴らしてから
  // ラウンド2 演出 or 結果表示へ進める。
  useEffect(() => {
    if (phase !== 'reveal' || !outcome) return;

    if (revealSubPhase === 'round1') {
      const attempts = outcome.round1.attempts;
      const attempt = attempts[revealIndex];
      const isLast = revealIndex === attempts.length - 1;

      if (!isLast) {
        // あいこ (やり直し) → もう一回の音声
        sound.play('draw');
        sound.play('voiceDraw');
        const t = setTimeout(() => setRevealIndex((i) => i + 1), REVEAL_STEP_MS);
        return () => clearTimeout(t);
      }

      // 決着した試行 = じゃんけんの結果を表示し、勝敗音声を鳴らす。
      if (attempt.outcome === 'LOSE') {
        // じゃんけんで負け → 負け音声 → その場で結果表示へ (ラウンド2 なし)
        sound.play('lose');
        sound.play('voiceLose');
        const t = setTimeout(() => setPhase('result'), REVEAL_STEP_MS);
        return () => clearTimeout(t);
      }
      // じゃんけんで勝ち → 勝ち音声 → あっちむいてPU の掛け声 → 方向対決へ
      sound.play('win');
      sound.play('voiceWin');
      const tAcchi = setTimeout(() => sound.play('voiceAcchi'), REVEAL_STEP_MS);
      const t = setTimeout(() => setRevealSubPhase('round2'), REVEAL_STEP_MS);
      return () => {
        clearTimeout(tAcchi);
        clearTimeout(t);
      };
    }

    // ラウンド2 (方向) の演出 → 一致/不一致に応じて REIRIE の勝敗音声を鳴らす。
    const matched = outcome.round2?.matched ?? false;
    if (matched) {
      // 方向一致 = プレイヤーの勝ち = REIRIE の負け
      sound.play('win');
      sound.play('voiceWin');
    } else {
      // 方向不一致 = プレイヤーの負け = REIRIE の勝ち
      sound.play('lose');
      sound.play('voiceLose');
    }
    const t = setTimeout(() => setPhase('result'), REVEAL_ROUND2_MS);
    return () => clearTimeout(t);
  }, [phase, outcome, revealIndex, revealSubPhase, sound]);

  // 結果フェーズに入ったら、勝利報酬のポイント獲得音のみ鳴らす。
  // 勝敗ボイス/効果音は reveal フェーズで既に再生済み。
  useEffect(() => {
    if (phase !== 'result' || !outcome) return;
    if (outcome.result === 'WIN' && outcome.reward > 0) {
      const t = setTimeout(() => sound.play('point'), 300);
      return () => clearTimeout(t);
    }
  }, [phase, outcome, sound]);

  function selectHand(h: JankenHand) {
    if (!canPlay || loading) return;
    // ミニゲームを開いてから最初の操作 = ゲーム開始音声を鳴らす。
    // (自動再生ブロック対策として、最初のユーザー操作の延長で再生する)
    sound.play('tap');
    if (!startVoicePlayed) {
      sound.play('voiceStart');
      setStartVoicePlayed(true);
    }
    setHand(h);
    setError(null);
    setPhase('direction');
  }

  async function selectDirection(dir: AcchiDirection) {
    if (!hand || loading) return;
    // 方向を選んで勝負を確定 (勝敗音声・掛け声は演出フェーズで再生する)。
    sound.play('tap');
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/me/games/acchi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hand, direction: dir }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'プレイに失敗しました');
      }
      const data = json as PlayResponse;
      setOutcome(data);
      setRemaining(data.remaining);
      setBalance(data.balance);
      setRevealIndex(0);
      setRevealSubPhase('round1');
      setPhase('reveal');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function playAgain() {
    // もう一度 → またね音声を鳴らしてから最初の画面 (じゃんけん) に戻す。
    sound.play('tap');
    sound.play('voiceBye');
    setHand(null);
    setOutcome(null);
    setError(null);
    setRevealIndex(0);
    setRevealSubPhase('round1');
    // 次のプレイでも開始音声が鳴るように、開始フラグを戻す。
    setStartVoicePlayed(false);
    setPhase('janken');
  }

  function endGame() {
    // 終了 → またね音声を鳴らしてからホーム (会員カード) に戻る。
    sound.play('tap');
    sound.play('voiceBye');
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
          <span className="font-bold text-amber-300">{initial.winReward}pt</span> ゲット！
        </p>
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="rounded-full bg-white/15 px-3 py-1">
            本日残り <span className="font-bold">{remaining}</span> / {initial.maxPerDay} 回
          </span>
          <span className="rounded-full bg-white/15 px-3 py-1">
            保有ポイント <span className="font-bold text-amber-300">{balance.toLocaleString()}</span>pt
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

      {/* じゃんけんフェーズ */}
      {phase === 'janken' && canPlay ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {/* キャラクター (待機で揺れる) */}
          <div className="animate-acchi-swing">
            <CharacterAvatar pose="idle" imageUrls={characterImageUrls} bob />
          </div>
          <p className="mb-1 text-sm text-slate-500">{CHARACTER_NAME} とじゃんけん勝負！</p>
          <p className="mb-1 text-lg font-bold text-slate-800">最初はグー、じゃんけん…</p>
          <p className="mb-4 text-xs text-slate-400">
            負けたらその場で終了。あいこならもう一回。勝てば方向対決に進めるよ！
          </p>
          <div className="grid grid-cols-3 gap-3">
            {(['ROCK', 'SCISSORS', 'PAPER'] as JankenHand[]).map((h) => (
              <button
                key={h}
                onClick={() => selectHand(h)}
                className="flex flex-col items-center gap-1 rounded-xl border-2 border-slate-200 bg-slate-50 py-4 transition hover:border-twilight-amethyst hover:bg-purple-50 active:scale-95"
              >
                <span className="text-4xl">{HAND_EMOJI[h]}</span>
                <span className="text-sm font-medium text-slate-700">{HAND_LABEL[h]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* 方向選択フェーズ */}
      {phase === 'direction' && hand ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {/* キャラはあなたの手を出している (演出) */}
          <CharacterAvatar pose={HAND_POSE[hand]} imageUrls={characterImageUrls} bob={false} />
          <p className="mb-1 text-sm text-slate-500">
            あなたの手: <span className="text-2xl">{HAND_EMOJI[hand]}</span> {HAND_LABEL[hand]}
          </p>
          <p className="mb-4 text-lg font-bold text-slate-800">あっちむいて… PU！</p>
          <p className="mb-4 text-xs text-slate-400">
            じゃんけんに勝てばあなたが「指す」番。{CHARACTER_NAME} が同じ方向を向いたら
            あなたの勝ち！（じゃんけんに負けると、方向対決に進めずその場で負けだよ）
          </p>
          <div className="mx-auto grid max-w-[220px] grid-cols-3 grid-rows-3 gap-2">
            <div />
            <DirButton dir="UP" onClick={selectDirection} disabled={loading} />
            <div />
            <DirButton dir="LEFT" onClick={selectDirection} disabled={loading} />
            <div className="flex items-center justify-center text-3xl">{loading ? '⏳' : '😀'}</div>
            <DirButton dir="RIGHT" onClick={selectDirection} disabled={loading} />
            <div />
            <DirButton dir="DOWN" onClick={selectDirection} disabled={loading} />
            <div />
          </div>
        </div>
      ) : null}

      {/* 決着演出フェーズ (ラウンド1のやり直し→決着、勝てばラウンド2) */}
      {phase === 'reveal' && outcome ? (
        <RevealCard
          outcome={outcome}
          revealIndex={revealIndex}
          revealSubPhase={revealSubPhase}
          characterImageUrls={characterImageUrls}
        />
      ) : null}

      {/* 結果フェーズ */}
      {phase === 'result' && outcome ? (
        <ResultCard
          outcome={outcome}
          canPlay={remaining > 0}
          onAgain={playAgain}
          onBack={endGame}
          characterImageUrls={characterImageUrls}
        />
      ) : null}

      {error ? (
        <p className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-center text-sm text-rose-700">{error}</p>
      ) : null}
    </div>
  );
}

function DirButton({
  dir,
  onClick,
  disabled,
}: {
  dir: AcchiDirection;
  onClick: (d: AcchiDirection) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onClick(dir)}
      disabled={disabled}
      aria-label={DIR_LABEL[dir]}
      className="flex items-center justify-center rounded-xl border-2 border-slate-200 bg-slate-50 py-3 text-3xl transition hover:border-twilight-amethyst hover:bg-purple-50 active:scale-95 disabled:opacity-50"
    >
      {DIR_EMOJI[dir]}
    </button>
  );
}

/**
 * ラウンド1 (じゃんけん、あいこによるやり直しを含む) → (勝てば) ラウンド2 (方向)
 * の決着までを 1 ステップずつ演出するカード。
 */
function RevealCard({
  outcome,
  revealIndex,
  revealSubPhase,
  characterImageUrls,
}: {
  outcome: PlayResponse;
  revealIndex: number;
  revealSubPhase: RevealSubPhase;
  characterImageUrls?: CharacterImageUrlMap;
}) {
  const attempts = outcome.round1.attempts;
  const attempt = attempts[revealIndex];
  const isLastAttempt = revealIndex === attempts.length - 1;

  if (revealSubPhase === 'round1') {
    const label = !isLastAttempt
      ? 'あいこ！もう一回っ！'
      : attempt.outcome === 'WIN'
        ? 'じゃんけん、勝った！'
        : 'じゃんけん、負けちゃった…';
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div key={`${revealIndex}-${attempt.outcome}`} className="animate-acchi-pop">
          <CharacterAvatar pose={HAND_POSE[attempt.cpu]} imageUrls={characterImageUrls} bob={false} />
        </div>
        <div className="mt-3 flex items-center justify-center gap-6 text-sm text-slate-600">
          <div>
            <p className="mb-1 text-xs text-slate-400">あなた</p>
            <p className="text-3xl">{HAND_EMOJI[attempt.player]}</p>
          </div>
          <p className="text-lg font-bold text-slate-400">VS</p>
          <div>
            <p className="mb-1 text-xs text-slate-400">{CHARACTER_NAME}</p>
            <p className="text-3xl">{HAND_EMOJI[attempt.cpu]}</p>
          </div>
        </div>
        <p className="mt-4 text-xl font-bold text-slate-800">{label}</p>
        {!isLastAttempt ? (
          <p className="mt-1 text-xs text-slate-400">もう一度じゃんけん…</p>
        ) : attempt.outcome === 'WIN' ? (
          <p className="mt-1 text-xs text-slate-400">方向対決に進むよ！</p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">ここで終了…</p>
        )}
      </div>
    );
  }

  // ラウンド2 (方向) 演出
  const round2 = outcome.round2;
  if (!round2) return null;
  const cpuPose: CharacterPose = DIRECTION_POSE[round2.cpu];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <div key={cpuPose} className="animate-acchi-turn">
        <CharacterAvatar pose={cpuPose} imageUrls={characterImageUrls} bob={false} />
      </div>
      <p className="mt-3 text-sm text-slate-500">
        あなたが「{DIR_LABEL[round2.player]}」を指す → {CHARACTER_NAME} は「
        {DIR_LABEL[round2.cpu]}」を向いた！
      </p>
      <p className="mt-2 text-xl font-bold text-slate-800">
        {round2.matched ? '方向が一致…！' : '方向が外れた…！'}
      </p>
    </div>
  );
}

function ResultCard({
  outcome,
  canPlay,
  onAgain,
  onBack,
  characterImageUrls,
}: {
  outcome: PlayResponse;
  canPlay: boolean;
  onAgain: () => void;
  onBack: () => void;
  characterImageUrls?: CharacterImageUrlMap;
}) {
  const win = outcome.result === 'WIN';
  const theme = win
    ? { bg: 'from-amber-50 to-yellow-100 border-amber-200', emoji: '🎉', label: 'あなたの勝ち！', color: 'text-amber-900' }
    : { bg: 'from-rose-50 to-red-100 border-rose-200', emoji: '😢', label: 'あなたの負け…', color: 'text-rose-900' };

  const decisive = outcome.round1.attempts[outcome.round1.attempts.length - 1];
  const round2 = outcome.round2;

  // CPU(=REIRIE) のポーズ: ラウンド2まで進んだ場合は向いた方向、
  // ラウンド1 (じゃんけん) だけで終わった場合は決着した手のポーズ。
  const cpuPose: CharacterPose = round2 ? DIRECTION_POSE[round2.cpu] : HAND_POSE[decisive.cpu];

  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${theme.bg} p-6 text-center shadow-sm`}>
      {/* REIRIE の演出 */}
      <div key={cpuPose} className="animate-acchi-turn">
        <CharacterAvatar pose={cpuPose} imageUrls={characterImageUrls} bob={false} />
      </div>
      <p className="text-xs text-slate-400">
        {round2
          ? `あなたが「${DIR_LABEL[round2.player]}」を指す → ${CHARACTER_NAME} は「${DIR_LABEL[round2.cpu]}」を向いた！`
          : `じゃんけんで負けてしまったため、方向対決には進めなかった…`}
      </p>

      <p className="mt-3 text-4xl animate-acchi-pop">{theme.emoji}</p>
      <p className={`mt-1 text-2xl font-bold ${theme.color}`}>{theme.label}</p>

      {/* 対戦内容 */}
      <div className="mt-5 flex items-center justify-center gap-6 text-sm text-slate-600">
        <div>
          <p className="mb-1 text-xs text-slate-400">あなた</p>
          <p className="text-3xl">{HAND_EMOJI[decisive.player]}</p>
          {round2 ? (
            <>
              <p className="text-2xl">{DIR_EMOJI[round2.player]}</p>
              <p className="text-[11px] text-slate-400">{DIR_LABEL[round2.player]}</p>
            </>
          ) : null}
        </div>
        <p className="text-lg font-bold text-slate-400">VS</p>
        <div>
          <p className="mb-1 text-xs text-slate-400">{CHARACTER_NAME}</p>
          <p className="text-3xl">{HAND_EMOJI[decisive.cpu]}</p>
          {round2 ? (
            <>
              <p className="text-2xl">{DIR_EMOJI[round2.cpu]}</p>
              <p className="text-[11px] text-slate-400">{DIR_LABEL[round2.cpu]}</p>
            </>
          ) : null}
        </div>
      </div>

      {win ? (
        <p className="mt-4 rounded-full bg-amber-200 px-4 py-2 font-bold text-amber-900">
          +{outcome.reward}pt 獲得！ (残高 {outcome.balance.toLocaleString()}pt)
        </p>
      ) : (
        <p className="mt-4 text-sm text-slate-500">残高 {outcome.balance.toLocaleString()}pt</p>
      )}

      {win && (outcome.rewardPointBonus ?? 0) > 0 ? (
        <p className="mt-2 rounded-full bg-purple-100 px-4 py-2 text-sm font-bold text-purple-800">
          🎁 特典ポイント +{outcome.rewardPointBonus}pt！
          {typeof outcome.rewardPointBalance === 'number'
            ? ` (残高 ${outcome.rewardPointBalance.toLocaleString()}pt)`
            : ''}
        </p>
      ) : null}

      <p className="mt-3 text-xs text-slate-400">本日残り {outcome.remaining} 回</p>

      <div className="mt-5 flex flex-col gap-2">
        {canPlay ? (
          <Button onClick={onAgain} variant="primary" size="lg">
            もう一度遊ぶ
          </Button>
        ) : (
          <p className="text-sm font-medium text-slate-500">本日のプレイは終了しました。また明日！</p>
        )}
        <Button onClick={onBack} variant="secondary" size="md">
          会員カードに戻る
        </Button>
      </div>
    </div>
  );
}
