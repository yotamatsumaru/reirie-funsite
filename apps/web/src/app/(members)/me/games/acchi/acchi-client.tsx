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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CHARACTER_IMAGE_VARIANTS,
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

/** 2段階フロー・フェーズ1 (じゃんけん) のレスポンス。 */
type JankenPhaseResponse = {
  round1: Round1;
  janken: { player: JankenHand; cpu: JankenHand; outcome: JankenOutcome };
  /** 勝った場合のみ発行される、方向対決 (フェーズ2) 用の署名付き進行トークン。負けなら null。 */
  round2Token: string | null;
  /** true なら (じゃんけん負けで) この時点で結果が確定している。false なら方向対決に進む。 */
  finished: boolean;
  result: 'WIN' | 'LOSE';
  reward: number;
  balance: number;
  playedToday: number;
  remaining: number;
  maxPerDay: number;
  rewardPointBonus?: number;
  rewardPointBalance?: number;
};

/** 2段階フロー・フェーズ2 (方向対決) のレスポンス。 */
type DirectionPhaseResponse = {
  janken: { player: JankenHand; cpu: JankenHand; outcome: JankenOutcome };
  round2: Round2;
  result: 'WIN' | 'LOSE';
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

// 2段階フロー:
//  start   … タップしてスタート (voiceStart)
//  janken  … 手を選ぶ → フェーズ1 API (じゃんけん確定 + プレイ回数消費)
//  reveal  … じゃんけん結果の演出 (あいこ→やり直し, 決着→勝ち/負け)。
//            負け → 「結果を確認」で result へ。
//            勝ち → 「あっちむいてPUIに挑戦!」で direction へ。
//  direction … 勝ったときだけ「方向 (指)」を選ぶ → フェーズ2 API (方向対決)。
//              → その結果を reveal(round2) で演出。
//  result  … 最終結果。
type Phase = 'start' | 'janken' | 'reveal' | 'direction' | 'result';

/** ラウンド1 演出のサブフェーズ: 試行を1つずつ見せる → (進めば) ラウンド2 を見せる */
type RevealSubPhase = 'round1' | 'round2';

/** あいこ (やり直し) の 1 試行を見せる時間 (ms)。あいこだけは自動で次へ進む。 */
const DRAW_STEP_MS = 900;

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
  // 最初は「タップしてスタート」画面。ここでの最初のタップで voiceStart を鳴らし、
  // 以降のボイスも自動再生ブロックされないようにする (ブラウザの自動再生ポリシー対策)。
  const [phase, setPhase] = useState<Phase>('start');
  const [hand, setHand] = useState<JankenHand | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PlayResponse | null>(null);
  // フェーズ1 (じゃんけん勝利) で得た方向対決用の進行トークン。
  // フェーズ2 (方向送信) でサーバーに渡す。
  const [round2Token, setRound2Token] = useState<string | null>(null);
  const [revealIndex, setRevealIndex] = useState(0);
  const [revealSubPhase, setRevealSubPhase] = useState<RevealSubPhase>('round1');
  // reveal フェーズで「決着/結果を表示し、ユーザーの操作 (ボタン) 待ち」の状態か。
  // これが true の間は自動では次へ進まず、ボタンを押して進める。
  //  - round1 で決着 (勝ち/負け) を表示 → ボタン待ち
  //  - round2 で結果を表示 → ボタン待ち
  // (あいこのやり直し表示だけは自動で次の試行へ進むので、これは使わない)
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
  // (サーバー側の advisory lock で最終的な超過付与は防げるが、そもそも
  //  余計なリクエストを投げない = UX / 負荷の両面で望ましい)
  const submittingRef = useRef(false);

  const canPlay = remaining > 0;

  // === 音声フロー ===
  // 0. サムネから来る → 「タップしてスタート」画面。最初のタップで開始音声 (voiceStart)
  //    を鳴らしてから じゃんけん画面へ (自動再生ポリシー対策)。
  // 1. じゃんけん → 手をタップ (tap のみ)。
  // 2. 方向選択 → 方向をタップ (tap) → API 送信 → 演出へ。
  // 3. 演出 (reveal):
  //      あいこ  → もう一回 (draw + voiceDraw)。自動で次の試行へ。
  //      じゃんけん決着を表示:
  //        負け  → 負け音声 (lose + voiceLose) → 「結果を確認」ボタン待ち → 結果へ
  //        勝ち  → 勝ち音声 (win + voiceWin) → 「あっちむいてPUIに挑戦」ボタン待ち
  //                 → ボタンで voiceAcchi を鳴らして 方向対決 (round2) へ
  //      方向対決の結果を表示:
  //        方向一致 (プレイヤー勝ち) → win + voiceWin → 「結果を確認」ボタン待ち → 結果へ
  //        方向不一致 (プレイヤー負け) → lose + voiceLose → 「結果を確認」ボタン待ち → 結果へ
  // 4. 結果 (result): 勝利時のみポイント音 (point)。
  //      もう一度 → またね音声 (voiceBye) → スタート画面へ
  //      終了     → またね音声 (voiceBye) → 会員カードへ

  // ラウンド1 の試行を 1 つずつ演出する。
  //  - あいこ (やり直し) の試行だけは自動で次へ進める。
  //  - 決着した試行 (勝ち/負け) は勝敗音声を鳴らして「ボタン待ち」状態にする。
  useEffect(() => {
    if (phase !== 'reveal' || !outcome) return;
    if (revealSubPhase !== 'round1') return;

    const attempts = outcome.round1.attempts;
    const attempt = attempts[revealIndex];
    const isLast = revealIndex === attempts.length - 1;

    if (!isLast) {
      // あいこ (やり直し) → もう一回の音声 → 自動で次の試行へ。
      sound.play('draw');
      sound.play('voiceDraw');
      const t = setTimeout(() => setRevealIndex((i) => i + 1), DRAW_STEP_MS);
      return () => clearTimeout(t);
    }

    // 決着した試行 = じゃんけんの結果をしっかり表示し、勝敗音声を鳴らして
    // ユーザーのボタン操作を待つ (自動では進めない)。
    if (attempt.outcome === 'LOSE') {
      sound.play('lose');
      sound.play('voiceLose');
    } else {
      sound.play('win');
      sound.play('voiceWin');
    }
    setAwaitingAction(true);
  }, [phase, outcome, revealIndex, revealSubPhase, sound]);

  // ラウンド2 (方向) の演出に入ったら、一致/不一致の勝敗音声を鳴らして
  // 「結果を確認」ボタン待ちにする。
  useEffect(() => {
    if (phase !== 'reveal' || !outcome) return;
    if (revealSubPhase !== 'round2') return;

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
    setAwaitingAction(true);
  }, [phase, outcome, revealSubPhase, sound]);

  // 結果フェーズに入ったら、勝利報酬のポイント獲得音のみ鳴らす。
  // 勝敗ボイス/効果音は reveal フェーズで既に再生済み。
  useEffect(() => {
    if (phase !== 'result' || !outcome) return;
    if (outcome.result === 'WIN' && outcome.reward > 0) {
      const t = setTimeout(() => sound.play('point'), 300);
      return () => clearTimeout(t);
    }
  }, [phase, outcome, sound]);

  // 「タップしてスタート」= 最初のユーザー操作。ここで開始音声を鳴らし、
  // 以降のボイスが自動再生ブロックされないようにしてから じゃんけん画面へ。
  function startGame() {
    if (!canPlay) return;
    sound.play('tap');
    sound.play('voiceStart');
    setError(null);
    setPhase('janken');
  }

  // 【フェーズ1: じゃんけん】手を選ぶ → サーバーがじゃんけんを確定 (プレイ回数消費)。
  // 結果 (round1) を演出フェーズ (reveal/round1) で見せる。
  //  - 負け  → 「結果を確認」で結果へ。
  //  - 勝ち  → 「あっちむいてPUIに挑戦!」で 方向選択 (direction) へ。
  async function selectHand(h: JankenHand) {
    // 二重送信ガード (ref を同期チェック)。
    if (!canPlay || loading || submittingRef.current) return;
    submittingRef.current = true;
    // 開始音声は start 画面で再生済み。ここではタップ音のみ。
    sound.play('tap');
    setHand(h);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/me/games/acchi/janken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hand: h }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'プレイに失敗しました');
      }
      const data = json as JankenPhaseResponse;
      // じゃんけん結果を outcome に反映 (勝ち時は round2 はまだ null)。
      setOutcome({
        janken: data.janken,
        direction: { player: 'UP', cpu: null },
        result: data.result,
        reward: data.reward,
        balance: data.balance,
        playedToday: data.playedToday,
        remaining: data.remaining,
        round1: data.round1,
        round2: null,
        rewardPointBonus: data.rewardPointBonus,
        rewardPointBalance: data.rewardPointBalance,
      });
      setRound2Token(data.round2Token);
      // 回数消費はフェーズ1で完了 → ヘッダーの残り回数を即反映。
      setRemaining(data.remaining);
      setBalance(data.balance);
      setRevealIndex(0);
      setRevealSubPhase('round1');
      setAwaitingAction(false);
      setPhase('reveal');
    } catch (e) {
      setError((e as Error).message);
      setPhase('janken');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  // reveal (round1 で決着=勝ち) → 「あっちむいてPUIに挑戦」ボタン。
  // ここで掛け声 (voiceAcchi) を鳴らしてから 方向選択 (direction) フェーズへ。
  // (実際のあっちむいてホイと同じく「じゃんけんに勝ってから指を出す」)
  function goToDirection() {
    sound.play('tap');
    sound.play('voiceAcchi');
    setAwaitingAction(false);
    setPhase('direction');
  }

  // reveal (round1 で決着=負け / round2 の結果表示後) → 「結果を確認」ボタン。
  // 結果画面へ進む。
  function goToResult() {
    sound.play('tap');
    setAwaitingAction(false);
    setPhase('result');
  }

  // 【フェーズ2: 方向対決】勝ったときだけ方向 (指) を選ぶ → サーバーが
  // フェーズ1で確定済みの勝敗に整合する CPU の方向を返す (回数消費・付与済み)。
  async function selectDirection(dir: AcchiDirection) {
    // 二重送信ガード。
    if (!round2Token || loading || submittingRef.current) return;
    submittingRef.current = true;
    sound.play('tap');
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/me/games/acchi/direction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: round2Token, direction: dir }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'プレイに失敗しました');
      }
      const data = json as DirectionPhaseResponse;
      // 方向対決の結果を outcome にマージし、reveal(round2) で演出する。
      setOutcome((prev) =>
        prev
          ? {
              ...prev,
              direction: { player: data.round2.player, cpu: data.round2.cpu },
              result: data.result,
              round2: data.round2,
            }
          : prev,
      );
      setRevealSubPhase('round2');
      setAwaitingAction(false);
      setPhase('reveal');
    } catch (e) {
      setError((e as Error).message);
      // 方向選択フェーズに留まり、再選択できるようにする。
      setPhase('direction');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  function playAgain() {
    // もう一度 → またね音声を鳴らしてから「タップしてスタート」画面に戻す。
    sound.play('tap');
    sound.play('voiceBye');
    setHand(null);
    setOutcome(null);
    setRound2Token(null);
    setError(null);
    setRevealIndex(0);
    setRevealSubPhase('round1');
    setAwaitingAction(false);
    // 次のプレイのパターン番号を抽選し直す (プレイごとに見た目が変わる)。
    setImageVariant(pickImageVariant());
    // スタート画面に戻す (最初のタップで開始音声を鳴らすフローを再現)。
    setPhase('start');
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
            じゃんけんに勝って、方向を当てたらキミの勝ち！勝てば{' '}
            <span className="font-bold text-amber-600">{initial.winReward}pt</span> ゲット！
          </p>
          <Button onClick={startGame} variant="primary" size="lg">
            タップしてスタート
          </Button>
        </div>
      ) : null}

      {/* じゃんけんフェーズ */}
      {phase === 'janken' && canPlay ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {/* キャラクター (待機で揺れる) */}
          <div className="animate-acchi-swing">
            <CharacterAvatar pose="idle" imageUrls={characterImageUrls} variant={imageVariant} bob />
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
                disabled={loading}
                className="flex flex-col items-center gap-1 rounded-xl border-2 border-slate-200 bg-slate-50 py-4 transition hover:border-twilight-amethyst hover:bg-purple-50 active:scale-95 disabled:opacity-50"
              >
                <span className="text-4xl">{HAND_EMOJI[h]}</span>
                <span className="text-sm font-medium text-slate-700">{HAND_LABEL[h]}</span>
              </button>
            ))}
          </div>
          {loading ? (
            <p className="mt-4 text-sm text-slate-400">じゃんけん、ぽん…！</p>
          ) : null}
        </div>
      ) : null}

      {/* 方向選択フェーズ (じゃんけんに勝ってから「指す」= 本来のあっちむいてホイの順序) */}
      {phase === 'direction' && hand ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {/* キャラはあなたの手を出している (演出) */}
          <CharacterAvatar pose={HAND_POSE[hand]} imageUrls={characterImageUrls} variant={imageVariant} bob={false} />
          <p className="mb-1 text-sm text-slate-500">
            じゃんけんに勝った！あなたが「指す」番だよ
          </p>
          <p className="mb-4 text-lg font-bold text-slate-800">あっちむいて… PU！</p>
          <p className="mb-4 text-xs text-slate-400">
            指したい方向を選ぼう。{CHARACTER_NAME} が同じ方向を向いたら あなたの勝ち！
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

      {/* 決着演出フェーズ (round1: じゃんけん結果 / round2: 方向対決結果) */}
      {phase === 'reveal' && outcome ? (
        <RevealCard
          outcome={outcome}
          revealIndex={revealIndex}
          revealSubPhase={revealSubPhase}
          awaitingAction={awaitingAction}
          onChallenge={goToDirection}
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
          onAgain={playAgain}
          onBack={endGame}
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
  awaitingAction,
  onChallenge,
  onConfirmResult,
  characterImageUrls,
  imageVariant,
}: {
  outcome: PlayResponse;
  revealIndex: number;
  revealSubPhase: RevealSubPhase;
  /** 決着/結果を表示し、ユーザーのボタン操作待ちか。 */
  awaitingAction: boolean;
  /** 「あっちむいてPUIに挑戦」ボタン (round1 勝ち時)。 */
  onChallenge: () => void;
  /** 「結果を確認」ボタン (round1 負け / round2 結果表示後)。 */
  onConfirmResult: () => void;
  characterImageUrls?: CharacterImageUrlMap;
  imageVariant: number;
}) {
  const attempts = outcome.round1.attempts;
  const attempt = attempts[revealIndex];
  const isLastAttempt = revealIndex === attempts.length - 1;

  if (revealSubPhase === 'round1') {
    // 決着した試行 (最後の試行) で勝ったか。
    const decisiveWin = isLastAttempt && attempt.outcome === 'WIN';
    const decisiveLose = isLastAttempt && attempt.outcome === 'LOSE';
    const label = !isLastAttempt
      ? 'あいこ！もう一回っ！'
      : attempt.outcome === 'WIN'
        ? 'じゃんけん、勝った！'
        : 'じゃんけん、負けちゃった…';
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div key={`${revealIndex}-${attempt.outcome}`} className="animate-acchi-pop">
          <CharacterAvatar pose={HAND_POSE[attempt.cpu]} imageUrls={characterImageUrls} variant={imageVariant} bob={false} />
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

        {/* 決着=勝ち → 「あっちむいてPUIに挑戦」ボタンで方向対決へ */}
        {decisiveWin && awaitingAction ? (
          <div className="mt-5">
            <p className="mb-3 text-sm text-slate-500">方向対決に進めるよ！</p>
            <Button onClick={onChallenge} variant="primary" size="lg">
              あっちむいてPUIに挑戦！
            </Button>
          </div>
        ) : null}

        {/* 決着=負け → 「結果を確認」ボタンで結果へ */}
        {decisiveLose && awaitingAction ? (
          <div className="mt-5">
            <p className="mb-3 text-xs text-slate-400">じゃんけんで負けてしまった…</p>
            <Button onClick={onConfirmResult} variant="secondary" size="lg">
              結果を確認
            </Button>
          </div>
        ) : null}

        {/* あいこ (自動で次へ) */}
        {!isLastAttempt ? (
          <p className="mt-1 text-xs text-slate-400">もう一度じゃんけん…</p>
        ) : null}
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
        <CharacterAvatar pose={cpuPose} imageUrls={characterImageUrls} variant={imageVariant} bob={false} />
      </div>
      <p className="mt-3 text-sm text-slate-500">
        あなたが「{DIR_LABEL[round2.player]}」を指す → {CHARACTER_NAME} は「
        {DIR_LABEL[round2.cpu]}」を向いた！
      </p>
      <p className="mt-2 text-xl font-bold text-slate-800">
        {round2.matched ? '方向が一致…！' : '方向が外れた…！'}
      </p>

      {/* round2 結果表示後 → 「結果を確認」ボタンで結果画面へ */}
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
  onAgain,
  onBack,
  characterImageUrls,
  imageVariant,
}: {
  outcome: PlayResponse;
  canPlay: boolean;
  onAgain: () => void;
  onBack: () => void;
  characterImageUrls?: CharacterImageUrlMap;
  imageVariant: number;
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
        <CharacterAvatar pose={cpuPose} imageUrls={characterImageUrls} variant={imageVariant} bob={false} />
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
