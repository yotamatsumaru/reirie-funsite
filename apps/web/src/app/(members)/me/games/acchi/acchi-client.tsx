'use client';

/**
 * あっち向いてホイ ミニゲーム (クライアント UI)。
 *
 * 重要: このコンポーネントは「演出」のみを担当する。
 * 勝敗・CPU の手/方向・ポイント付与はすべてサーバー (POST /api/me/games/acchi) が確定する。
 * 送信するのはプレイヤーの「手」と「方向」だけ。
 *
 * フロー:
 *  1. じゃんけん: 手を選ぶ → サーバーに送るのは方向選択後にまとめて送るため、
 *     ここではいったんローカルに手を保持し、勝敗の "見込み" は出さない。
 *  2. 方向選択: 上下左右を選ぶ → ここで初めて API を 1 回叩き、サーバーが
 *     じゃんけん結果・あっち向いて結果・ポイントをまとめて返す。
 *  3. 結果表示 → もう一度 / 終了。
 *
 * これにより「サーバーが一括判定」を保ちつつ、UI 上は 2 段階に見せられる。
 *
 * 演出: REIRIE キャラクター (CharacterAvatar) が
 *   待機 → じゃんけんの手 → あっち向いてホイで横顔
 * とアニメーションで動く。キャラ画像の差し替えは ./character.ts 参照。
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type JankenHand,
  type AcchiDirection,
  type AcchiVoiceUrlMap,
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

type SequenceRound = {
  jankenPlayer: JankenHand;
  jankenCpu: JankenHand;
  jankenOutcome: 'WIN' | 'LOSE' | 'DRAW';
  decided: boolean;
  pointedDirection: AcchiDirection | null;
  facedDirection: AcchiDirection | null;
  attacker: 'PLAYER' | 'CPU' | null;
};

type PlayResponse = {
  janken: { player: JankenHand; cpu: JankenHand; outcome: 'WIN' | 'LOSE' | 'DRAW' };
  direction: { player: AcchiDirection; cpu: AcchiDirection };
  result: 'WIN' | 'LOSE' | 'DRAW';
  reward: number;
  balance: number;
  playedToday: number;
  remaining: number;
  sequence?: SequenceRound[];
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

type Phase = 'janken' | 'direction' | 'result';

export function AcchiGameClient({
  initial,
  voiceUrls = {},
}: {
  initial: Initial;
  voiceUrls?: AcchiVoiceUrlMap;
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

  const canPlay = remaining > 0;

  // 結果フェーズに入ったら、勝敗に応じた効果音とボイスを鳴らす。
  useEffect(() => {
    if (phase !== 'result' || !outcome) return;
    if (outcome.result === 'WIN') {
      sound.play('win');
      sound.play('voiceWin');
      if (outcome.reward > 0) {
        // ポイント獲得音は少し遅らせて重ねる。
        const t = setTimeout(() => sound.play('point'), 450);
        return () => clearTimeout(t);
      }
    } else if (outcome.result === 'LOSE') {
      sound.play('lose');
      sound.play('voiceLose');
    } else {
      sound.play('draw');
      sound.play('voiceDraw');
    }
  }, [phase, outcome, sound]);

  function selectHand(h: JankenHand) {
    if (!canPlay || loading) return;
    // じゃんけんの手を選んだタイミング = 最初のユーザー操作。
    // ここで開始ボイスとタップ音を鳴らす (自動再生ブロック対策も兼ねる)。
    sound.play('tap');
    sound.play('voiceStart');
    setHand(h);
    setError(null);
    setPhase('direction');
  }

  async function selectDirection(dir: AcchiDirection) {
    if (!hand || loading) return;
    // 「あっち向いて…ホイ！」の掛け声。
    sound.play('tap');
    sound.play('voiceAcchi');
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
      setPhase('result');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function playAgain() {
    sound.play('tap');
    setHand(null);
    setOutcome(null);
    setError(null);
    setPhase('janken');
  }

  return (
    <div>
      {/* ヘッダー */}
      <div className="mb-6 rounded-2xl bg-gradient-to-br from-twilight-plum via-purple-800 to-twilight-amethyst p-6 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold">あっち向いてホイ</h1>
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
            <CharacterAvatar pose="idle" bob />
          </div>
          <p className="mb-1 text-sm text-slate-500">{CHARACTER_NAME} とじゃんけん勝負！</p>
          <p className="mb-4 text-lg font-bold text-slate-800">最初はグー、じゃんけん…</p>
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
          <CharacterAvatar pose={HAND_POSE[hand]} bob={false} />
          <p className="mb-1 text-sm text-slate-500">
            あなたの手: <span className="text-2xl">{HAND_EMOJI[hand]}</span> {HAND_LABEL[hand]}
          </p>
          <p className="mb-4 text-lg font-bold text-slate-800">あっち向いて… ホイ！</p>
          <p className="mb-4 text-xs text-slate-400">
            じゃんけんに勝てばあなたが「指す」番。{CHARACTER_NAME} が同じ方向を向いたら
            あなたの勝ち！（負けると {CHARACTER_NAME} が指す方向につられたら負け）
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

      {/* 結果フェーズ */}
      {phase === 'result' && outcome ? (
        <ResultCard outcome={outcome} canPlay={remaining > 0} onAgain={playAgain} onBack={() => router.push('/me/card')} />
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

function ResultCard({
  outcome,
  canPlay,
  onAgain,
  onBack,
}: {
  outcome: PlayResponse;
  canPlay: boolean;
  onAgain: () => void;
  onBack: () => void;
}) {
  const win = outcome.result === 'WIN';
  const lose = outcome.result === 'LOSE';
  const theme = win
    ? { bg: 'from-amber-50 to-yellow-100 border-amber-200', emoji: '🎉', label: 'あなたの勝ち！', color: 'text-amber-900' }
    : lose
      ? { bg: 'from-rose-50 to-red-100 border-rose-200', emoji: '😢', label: 'あなたの負け…', color: 'text-rose-900' }
      : { bg: 'from-slate-50 to-slate-100 border-slate-200', emoji: '🤝', label: '勝負つかず！', color: 'text-slate-700' };

  // CPU(=REIRIE) が向いた方向の横顔ポーズ
  const cpuPose: CharacterPose = DIRECTION_POSE[outcome.direction.cpu];

  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${theme.bg} p-6 text-center shadow-sm`}>
      {/* REIRIE が向きを変える演出 (横顔) */}
      <div key={cpuPose} className="animate-acchi-turn">
        <CharacterAvatar pose={cpuPose} bob={false} />
      </div>
      <p className="text-xs text-slate-400">
        {outcome.janken.outcome === 'WIN'
          ? `あなたが「${DIR_LABEL[outcome.direction.player]}」を指す → ${CHARACTER_NAME} は「${DIR_LABEL[outcome.direction.cpu]}」を向いた！`
          : `${CHARACTER_NAME} が「${DIR_LABEL[outcome.direction.cpu]}」を指す！`}
      </p>

      <p className="mt-3 text-4xl animate-acchi-pop">{theme.emoji}</p>
      <p className={`mt-1 text-2xl font-bold ${theme.color}`}>{theme.label}</p>

      {/* 対戦内容 */}
      <div className="mt-5 flex items-center justify-center gap-6 text-sm text-slate-600">
        <div>
          <p className="mb-1 text-xs text-slate-400">あなた</p>
          <p className="text-3xl">{HAND_EMOJI[outcome.janken.player]}</p>
          <p className="text-2xl">{DIR_EMOJI[outcome.direction.player]}</p>
          <p className="text-[11px] text-slate-400">{DIR_LABEL[outcome.direction.player]}</p>
        </div>
        <p className="text-lg font-bold text-slate-400">VS</p>
        <div>
          <p className="mb-1 text-xs text-slate-400">{CHARACTER_NAME}</p>
          <p className="text-3xl">{HAND_EMOJI[outcome.janken.cpu]}</p>
          <p className="text-2xl">{DIR_EMOJI[outcome.direction.cpu]}</p>
          <p className="text-[11px] text-slate-400">{DIR_LABEL[outcome.direction.cpu]}</p>
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
