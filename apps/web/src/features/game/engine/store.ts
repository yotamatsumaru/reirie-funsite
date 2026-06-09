/**
 * Game Store (Zustand)
 *
 * - 純粋な engine.ts をラップする React 統合層
 * - GameState を購読可能にし、副作用 (BGM/SE/シェイク) を action として吐き出す
 * - UI コンポーネントから next() / selectChoice() を呼ぶだけで進行
 *
 * 設計方針:
 *   1. 純粋ロジック (engine.ts) はテスト容易性のため不変
 *   2. ストアは "状態 + UI 用フレーム" を保持
 *   3. 副作用 (Howler 等) はサブスクライブ層で処理 (このファイルでは dispatch のみ)
 */
'use client';

import { create } from 'zustand';
import {
  advance,
  applyGiftEffect,
  buildFrame,
  createInitialState,
  estimateRoute,
  restoreState,
  selectChoice as engineSelectChoice,
  snapshotState,
} from './engine';
import type {
  AdvanceContext,
  CurrentFrame,
  EngineAction,
  FrameContext,
  GameState,
  RouteResult,
  ScenarioScript,
} from './types';
import type { SaveSnapshot } from './engine';

export interface GameStoreState {
  /** 現在実行中のシナリオ (validate 済) */
  script: ScenarioScript | null;
  /** Prisma 上のシナリオ ID (セーブ用) */
  scenarioId: string | null;
  /** ゲーム状態 */
  state: GameState | null;
  /** 表示用フレーム (UI が render する対象) */
  frame: CurrentFrame | null;
  /** 直近に発火された副作用 (UI レイヤが consume) */
  pendingActions: EngineAction[];
  /** セーブ専用フィールド: 直近のフレームコンテキスト (背景・BGM 維持) */
  context: FrameContext;
  /** 課金 / プレミアム状態 */
  ownedItemSlugs: Set<string>;
  isPremium: boolean;
  /** UI の見た目用 effects 状態 */
  shake: { intensity: 'light' | 'medium' | 'heavy'; durationMs: number; nonce: number } | null;
  flash: { color: string; durationMs: number; nonce: number } | null;
  cgKey: string | null;

  // ---------- actions ----------
  /** シナリオ開始 (state は新規 or 復元) */
  start(script: ScenarioScript, scenarioId: string, opts?: {
    restoreFrom?: SaveSnapshot;
    isPremium?: boolean;
    ownedItemSlugs?: string[];
  }): void;
  /** 次のステップへ進む (say/narration 等の "クリック待ち" を消化) */
  next(): void;
  /** 選択肢クリック */
  selectChoice(index: number): void;
  /** プレゼント使用 (シナリオ外) */
  useGift(affinityBoost: number): void;
  /** ルート推定値を取得 */
  getEstimatedRoute(): RouteResult;
  /** セーブ用スナップショット */
  snapshot(): SaveSnapshot | null;
  /** 課金 / プレミアム情報を更新 */
  setOwnership(opts: { ownedItemSlugs?: string[]; isPremium?: boolean }): void;
  /** UI が consume したら呼ぶ (蓄積アクションをクリア) */
  clearPendingActions(): void;
  clearShake(): void;
  clearFlash(): void;
  clearCg(): void;
  /** 完全リセット */
  reset(): void;
}

const emptyContext: FrameContext = {
  background: undefined,
  bgm: undefined,
  activeSpeaker: undefined,
  activeExpression: undefined,
};

export const useGameStore = create<GameStoreState>((set, get) => ({
  script: null,
  scenarioId: null,
  state: null,
  frame: null,
  pendingActions: [],
  context: emptyContext,
  ownedItemSlugs: new Set<string>(),
  isPremium: false,
  shake: null,
  flash: null,
  cgKey: null,

  start: (script, scenarioId, opts) => {
    const isPremium = opts?.isPremium ?? false;
    const ownedItemSlugs = new Set(opts?.ownedItemSlugs ?? []);
    const initial = opts?.restoreFrom
      ? restoreState(opts.restoreFrom)
      : createInitialState(script);
    const ctx: AdvanceContext = { isPremium, ownedItemSlugs };
    const result = advance(script, initial, ctx, { firstCall: true });

    const newContext: FrameContext = {
      background: result.enteredScene?.background,
      bgm: result.enteredScene?.bgm ?? null,
      activeSpeaker: undefined,
      activeExpression: undefined,
    };
    const frame = buildFrame(script, result.state, newContext, ctx);

    set({
      script,
      scenarioId,
      state: result.state,
      frame,
      pendingActions: result.actions,
      context: extractContextFromFrame(newContext, frame),
      ownedItemSlugs,
      isPremium,
      shake: null,
      flash: null,
      cgKey: null,
    });

    // 副作用を内部状態へも反映 (シェイク / フラッシュ / CG)
    applyVisualEffects(set, result.actions);
  },

  next: () => {
    const { script, state, ownedItemSlugs, isPremium, context } = get();
    if (!script || !state) return;
    if (state.isEnded) return;

    // クリック待ちステップを 1 つ消化 (= stepIndex を進める)
    const nextState: GameState = {
      ...state,
      stepIndex: state.stepIndex + 1,
    };

    const ctx: AdvanceContext = { ownedItemSlugs, isPremium };
    const result = advance(script, nextState, ctx);

    const newContext = applyEnteredScene(context, result.enteredScene);
    const frame = buildFrame(script, result.state, newContext, ctx);

    set((s) => ({
      state: result.state,
      frame,
      pendingActions: [...s.pendingActions, ...result.actions],
      context: extractContextFromFrame(newContext, frame),
    }));

    applyVisualEffects(set, result.actions);
  },

  selectChoice: (index) => {
    const { script, state, ownedItemSlugs, isPremium, context } = get();
    if (!script || !state) return;
    const step = script.scenes[state.sceneKey]?.steps[state.stepIndex];
    if (!step || step.type !== 'choice') return;

    // 1. 選択肢を適用
    const sel = engineSelectChoice(script, state, index);
    let s = sel.state;
    const actions: EngineAction[] = [...sel.actions];
    let newContext: FrameContext = applyEnteredScene(context, sel.entered);

    // 2. 選択肢適用後、次のクリック待ちまで自動進行
    const ctx: AdvanceContext = { ownedItemSlugs, isPremium };
    const result = advance(script, s, ctx);
    s = result.state;
    actions.push(...result.actions);
    newContext = applyEnteredScene(newContext, result.enteredScene);

    const frame = buildFrame(script, s, newContext, ctx);

    set((store) => ({
      state: s,
      frame,
      pendingActions: [...store.pendingActions, ...actions],
      context: extractContextFromFrame(newContext, frame),
    }));

    applyVisualEffects(set, actions);
  },

  useGift: (affinityBoost) => {
    const { state } = get();
    if (!state) return;
    const r = applyGiftEffect(state, affinityBoost);
    set({ state: r.state });
  },

  getEstimatedRoute: () => {
    const { state } = get();
    if (!state) return 'IN_PROGRESS';
    return estimateRoute(state);
  },

  snapshot: () => {
    const { state, scenarioId } = get();
    if (!state || !scenarioId) return null;
    return snapshotState(scenarioId, state);
  },

  setOwnership: ({ ownedItemSlugs, isPremium }) => {
    set((s) => ({
      ownedItemSlugs: ownedItemSlugs ? new Set(ownedItemSlugs) : s.ownedItemSlugs,
      isPremium: typeof isPremium === 'boolean' ? isPremium : s.isPremium,
    }));
  },

  clearPendingActions: () => set({ pendingActions: [] }),
  clearShake: () => set({ shake: null }),
  clearFlash: () => set({ flash: null }),
  clearCg: () => set({ cgKey: null }),

  reset: () =>
    set({
      script: null,
      scenarioId: null,
      state: null,
      frame: null,
      pendingActions: [],
      context: emptyContext,
      shake: null,
      flash: null,
      cgKey: null,
    }),
}));

// ---------- 内部ユーティリティ ----------

function extractContextFromFrame(prev: FrameContext, frame: CurrentFrame): FrameContext {
  return {
    background: frame.background ?? prev.background,
    bgm: frame.bgm ?? prev.bgm,
    activeSpeaker: frame.activeSpeaker ?? prev.activeSpeaker,
    activeExpression: frame.activeExpression ?? prev.activeExpression,
  };
}

function applyEnteredScene(
  prev: FrameContext,
  entered: { sceneKey: string; background?: string; bgm?: string } | undefined,
): FrameContext {
  if (!entered) return prev;
  return {
    ...prev,
    background: entered.background ?? prev.background,
    bgm: entered.bgm ?? prev.bgm,
    // シーン遷移時は話者をリセット
    activeSpeaker: undefined,
    activeExpression: undefined,
  };
}

function applyVisualEffects(
  set: (
    partial:
      | Partial<GameStoreState>
      | ((s: GameStoreState) => Partial<GameStoreState>),
  ) => void,
  actions: EngineAction[],
): void {
  for (const a of actions) {
    if (a.type === 'shake') {
      set({ shake: { intensity: a.intensity, durationMs: a.durationMs, nonce: Date.now() + Math.random() } });
    } else if (a.type === 'flash') {
      set({ flash: { color: a.color, durationMs: a.durationMs, nonce: Date.now() + Math.random() } });
    } else if (a.type === 'show_cg') {
      set({ cgKey: a.key });
    }
  }
}

/** UI 側で副作用 (BGM/SE) を hook として消化するためのセレクタ */
export const selectPendingActions = (s: GameStoreState) => s.pendingActions;
