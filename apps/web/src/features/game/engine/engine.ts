/**
 * シナリオランナー (純粋ロジック)
 *
 * - DOM や React に依存しない、テスト容易な状態遷移エンジン
 * - 1 ステップずつ前進する設計 (next() を呼ぶたびに 1 ステップ進む)
 * - 副作用 (BGM/SE 再生、シェイク等) は EngineAction として吐き出す
 */
import type {
  ScenarioScript,
  Step,
  Effect,
  Condition,
  GameState,
  CurrentFrame,
  ChoiceView,
  EngineAction,
  AdvanceContext,
  RouteResult,
  FlagsMap,
} from './types';

// ---------- 初期状態 ----------

export function createInitialState(script: ScenarioScript, override?: Partial<GameState>): GameState {
  return {
    sceneKey: script.startSceneKey,
    stepIndex: 0,
    affinity: 0,
    flags: {},
    routeResult: 'IN_PROGRESS',
    isEnded: false,
    ...override,
  };
}

// ---------- 条件評価 ----------

export function evaluateCondition(cond: Condition, state: GameState): boolean {
  if (cond.kind === 'affinity') {
    const v = state.affinity;
    switch (cond.op) {
      case 'gte':
        return v >= cond.value;
      case 'lte':
        return v <= cond.value;
      case 'eq':
        return v === cond.value;
      case 'gt':
        return v > cond.value;
      case 'lt':
        return v < cond.value;
    }
  }
  if (cond.kind === 'flag') {
    const v = state.flags[cond.key];
    if (cond.op === 'eq') return v === cond.value;
    if (cond.op === 'neq') return v !== cond.value;
  }
  return false;
}

export function evaluateAll(conds: Condition[] | undefined, state: GameState): boolean {
  if (!conds || conds.length === 0) return true;
  return conds.every((c) => evaluateCondition(c, state));
}

// ---------- エフェクト適用 ----------

export interface ApplyResult {
  next: GameState;
  actions: EngineAction[];
}

export function applyEffects(effects: Effect[], state: GameState): ApplyResult {
  let s: GameState = { ...state, flags: { ...state.flags } };
  const actions: EngineAction[] = [];

  for (const e of effects) {
    if (e.type === 'affinity') {
      const next = clampAffinity(s.affinity + e.delta);
      s = { ...s, affinity: next };
    } else if (e.type === 'flag') {
      s = { ...s, flags: { ...s.flags, [e.key]: e.value } };
    } else if (e.type === 'route') {
      if (s.routeResult !== e.result) {
        s = { ...s, routeResult: e.result };
        actions.push({ type: 'route_changed', result: e.result });
      }
    } else if (e.type === 'unlock_scene') {
      // unlock_scene はメタ情報。実装側ではフラグとして記録しておく
      s = { ...s, flags: { ...s.flags, [`__unlocked.${e.sceneKey}`]: true } };
    }
  }

  return { next: s, actions };
}

function clampAffinity(v: number): number {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v);
}

// ---------- ステップ取得 ----------

export function getStep(script: ScenarioScript, state: GameState): Step | null {
  const scene = script.scenes[state.sceneKey];
  if (!scene) return null;
  return scene.steps[state.stepIndex] ?? null;
}

export function getScene(script: ScenarioScript, sceneKey: string) {
  return script.scenes[sceneKey];
}

// ---------- 選択肢ビュー生成 ----------

export function buildChoiceViews(
  step: Extract<Step, { type: 'choice' }>,
  state: GameState,
  ctx: AdvanceContext,
): ChoiceView[] {
  return step.choices.map((c, index) => {
    const hidden = !evaluateAll(c.showIf, state);
    let locked = false;
    let lockReason: ChoiceView['lockReason'];
    if (c.premiumOnly && !ctx.isPremium) {
      locked = true;
      lockReason = 'premiumOnly';
    } else if (c.requireItemSlug && !(ctx.ownedItemSlugs?.has(c.requireItemSlug) ?? false)) {
      locked = true;
      lockReason = 'requireItem';
    }
    return {
      index,
      label: c.label,
      hidden,
      locked,
      lockReason,
      requireItemSlug: c.requireItemSlug,
      premiumOnly: c.premiumOnly,
    };
  });
}

// ---------- フレーム生成 (UI 表示用) ----------

export interface FrameContext {
  /** 直近の話者 (sprite を維持するため) */
  activeSpeaker?: string;
  activeExpression?: string;
  background?: string;
  bgm?: string | null;
}

export function buildFrame(
  script: ScenarioScript,
  state: GameState,
  prevContext: FrameContext,
  ctx: AdvanceContext,
): CurrentFrame {
  const step = getStep(script, state);
  let choices: ChoiceView[] | undefined;
  if (step?.type === 'choice') {
    choices = buildChoiceViews(step, state, ctx);
  }

  // 話者・表情を維持
  let activeSpeaker = prevContext.activeSpeaker;
  let activeExpression = prevContext.activeExpression;
  if (step?.type === 'say') {
    activeSpeaker = step.speaker;
    activeExpression = step.expression ?? activeExpression;
  }

  return {
    background: prevContext.background,
    bgm: prevContext.bgm ?? undefined,
    step,
    choices,
    activeSpeaker,
    activeExpression,
  };
}

// ---------- 前進 (next step) ----------

export interface AdvanceResult {
  state: GameState;
  actions: EngineAction[];
  /** 進めた結果到達した step (UI 描画対象) */
  step: Step | null;
  /** シーン入場直後の場合に通知する背景・BGM */
  enteredScene?: { sceneKey: string; background?: string; bgm?: string };
}

/**
 * 現在のステップを「実行」して次へ進める。
 * say / narration / choice はユーザーの操作待ち (実行は UI 側で副作用なし)
 *   → このメソッドはこれらに到達した時点で停止 (UI が render する)
 *
 * background / bgm / se / cg / effect / shake / flash / jump / branch / end は
 * その場で適用してさらに前進する (連続して描画不要なステップを飛ばす)。
 *
 * 呼び出しパターン:
 *   const result = advance(script, state, ctx);
 *   render(result.step);
 *   // ユーザータップ → state = result.state, advance(...) で次へ
 */
export function advance(
  script: ScenarioScript,
  state: GameState,
  ctx: AdvanceContext = {},
  options: { firstCall?: boolean } = {},
): AdvanceResult {
  let s = state;
  const actions: EngineAction[] = [];
  let enteredScene: AdvanceResult['enteredScene'];

  // 安全装置: 無限ループ防止 (jump / branch の連鎖)
  let safetyCount = 0;
  const SAFETY_LIMIT = 200;

  // firstCall の場合、開始シーンの background / bgm を発火
  if (options.firstCall) {
    const startScene = script.scenes[s.sceneKey];
    if (startScene) {
      enteredScene = {
        sceneKey: s.sceneKey,
        background: startScene.background,
        bgm: startScene.bgm,
      };
      if (startScene.background) {
        actions.push({ type: 'set_background', key: startScene.background });
      }
      if (startScene.bgm) {
        actions.push({ type: 'set_bgm', key: startScene.bgm });
      }
    }
  }

  while (safetyCount++ < SAFETY_LIMIT) {
    const step = getStep(script, s);
    if (!step) {
      // シーン末端 — 次のシーンが指定されていなければ終了
      s = { ...s, isEnded: true };
      actions.push({ type: 'ended' });
      return { state: s, actions, step: null, enteredScene };
    }

    // ユーザー操作待ちステップは return
    if (step.type === 'say' || step.type === 'narration' || step.type === 'choice') {
      return { state: s, actions, step, enteredScene };
    }

    // 即時実行ステップ
    if (step.type === 'background') {
      actions.push({ type: 'set_background', key: step.key, fade: step.fade });
      s = { ...s, stepIndex: s.stepIndex + 1 };
      continue;
    }
    if (step.type === 'bgm') {
      actions.push({ type: 'set_bgm', key: step.key, volume: step.volume });
      s = { ...s, stepIndex: s.stepIndex + 1 };
      continue;
    }
    if (step.type === 'se') {
      actions.push({ type: 'play_se', key: step.key });
      s = { ...s, stepIndex: s.stepIndex + 1 };
      continue;
    }
    if (step.type === 'cg') {
      actions.push({ type: 'show_cg', key: step.key, durationMs: step.durationMs });
      s = { ...s, stepIndex: s.stepIndex + 1 };
      continue;
    }
    if (step.type === 'shake') {
      actions.push({ type: 'shake', intensity: step.intensity, durationMs: step.durationMs });
      s = { ...s, stepIndex: s.stepIndex + 1 };
      continue;
    }
    if (step.type === 'flash') {
      actions.push({ type: 'flash', color: step.color, durationMs: step.durationMs });
      s = { ...s, stepIndex: s.stepIndex + 1 };
      continue;
    }
    if (step.type === 'effect') {
      const r = applyEffects(step.effects, s);
      s = { ...r.next, stepIndex: s.stepIndex + 1 };
      actions.push(...r.actions);
      continue;
    }
    if (step.type === 'jump') {
      const result = jumpTo(script, s, step.next);
      s = result.state;
      if (result.entered) {
        enteredScene = result.entered;
        if (result.entered.background) {
          actions.push({ type: 'set_background', key: result.entered.background });
        }
        if (result.entered.bgm) {
          actions.push({ type: 'set_bgm', key: result.entered.bgm });
        }
      }
      continue;
    }
    if (step.type === 'branch') {
      const matched = step.branches.find((b) => evaluateAll(b.when, s));
      const target = matched?.next ?? step.else;
      if (!target) {
        // 分岐に合致しなかった上に else もない → スキップ
        s = { ...s, stepIndex: s.stepIndex + 1 };
        continue;
      }
      const result = jumpTo(script, s, target);
      s = result.state;
      if (result.entered) {
        enteredScene = result.entered;
        if (result.entered.background) {
          actions.push({ type: 'set_background', key: result.entered.background });
        }
        if (result.entered.bgm) {
          actions.push({ type: 'set_bgm', key: result.entered.bgm });
        }
      }
      continue;
    }
    if (step.type === 'end') {
      if (step.effects && step.effects.length > 0) {
        const r = applyEffects(step.effects, s);
        s = r.next;
        actions.push(...r.actions);
      }
      s = { ...s, isEnded: true };
      actions.push({ type: 'ended' });
      return { state: s, actions, step: null, enteredScene };
    }

    // 未知のステップ — 次へ
    s = { ...s, stepIndex: s.stepIndex + 1 };
  }

  // 安全装置発動
  // eslint-disable-next-line no-console
  console.warn('[GameEngine] advance safety limit reached');
  return { state: s, actions, step: null, enteredScene };
}

// ---------- 選択肢クリック ----------

export function selectChoice(
  script: ScenarioScript,
  state: GameState,
  choiceIndex: number,
): { state: GameState; actions: EngineAction[]; entered?: { sceneKey: string; background?: string; bgm?: string } } {
  const step = getStep(script, state);
  if (!step || step.type !== 'choice') {
    return { state, actions: [] };
  }
  const choice = step.choices[choiceIndex];
  if (!choice) return { state, actions: [] };

  // エフェクト適用
  const eff = applyEffects(choice.effects ?? [], state);
  let s = eff.next;
  const actions = [...eff.actions];

  // 次のシーンへ or 次のステップへ
  if (choice.next) {
    const r = jumpTo(script, s, choice.next);
    s = r.state;
    if (r.entered) {
      if (r.entered.background) {
        actions.push({ type: 'set_background', key: r.entered.background });
      }
      if (r.entered.bgm) {
        actions.push({ type: 'set_bgm', key: r.entered.bgm });
      }
      return { state: s, actions, entered: r.entered };
    }
    return { state: s, actions };
  }
  s = { ...s, stepIndex: s.stepIndex + 1 };
  return { state: s, actions };
}

// ---------- シーン遷移 ----------

function jumpTo(
  script: ScenarioScript,
  state: GameState,
  sceneKey: string,
): { state: GameState; entered?: { sceneKey: string; background?: string; bgm?: string } } {
  const scene = script.scenes[sceneKey];
  if (!scene) {
    // eslint-disable-next-line no-console
    console.warn(`[GameEngine] jumpTo: scene "${sceneKey}" not found`);
    return { state: { ...state, isEnded: true } };
  }
  return {
    state: { ...state, sceneKey, stepIndex: 0 },
    entered: { sceneKey, background: scene.background, bgm: scene.bgm },
  };
}

// ---------- プレゼント使用 (シナリオ外) ----------

/**
 * プレゼントを使用 (シナリオ画面外の "プレゼントする" コマンド)。
 * 親密度を boost し、ルートエンディングへの寄与を計算する。
 */
export function applyGiftEffect(
  state: GameState,
  affinityBoost: number,
): { state: GameState } {
  return {
    state: {
      ...state,
      affinity: clampAffinity(state.affinity + affinityBoost),
    },
  };
}

// ---------- ルート判定 ----------

export interface RouteThresholds {
  loveMin: number;     // この値以上で恋愛エンドの可能性
  friendMin: number;   // この値以上で友情エンド
}

export const DEFAULT_THRESHOLDS: RouteThresholds = {
  loveMin: 70,
  friendMin: 40,
};

/**
 * 進行中のキャラクターについて、現在のパラメータから候補ルートを推定 (UI 表示用)
 * 実際のエンディング確定はシナリオ内の effect で行う
 */
export function estimateRoute(
  state: GameState,
  thresholds: RouteThresholds = DEFAULT_THRESHOLDS,
): RouteResult {
  if (state.routeResult !== 'IN_PROGRESS') return state.routeResult;
  if (state.affinity >= thresholds.loveMin) return 'LOVE_END';
  if (state.affinity >= thresholds.friendMin) return 'FRIEND_END';
  return 'IN_PROGRESS';
}

// ---------- セーブ / ロード ----------

export interface SaveSnapshot {
  scenarioId: string;
  sceneKey: string;
  stepIndex: number;
  affinity: number;
  flags: FlagsMap;
}

export function snapshotState(scenarioId: string, state: GameState): SaveSnapshot {
  return {
    scenarioId,
    sceneKey: state.sceneKey,
    stepIndex: state.stepIndex,
    affinity: state.affinity,
    flags: { ...state.flags },
  };
}

export function restoreState(snapshot: SaveSnapshot): GameState {
  return {
    sceneKey: snapshot.sceneKey,
    stepIndex: snapshot.stepIndex,
    affinity: snapshot.affinity,
    flags: { ...snapshot.flags },
    routeResult: 'IN_PROGRESS',
    isEnded: false,
  };
}
