/**
 * Game engine — pure logic tests
 */
import {
  createInitialState,
  evaluateCondition,
  evaluateAll,
  applyEffects,
  buildChoiceViews,
  advance,
  selectChoice,
  applyGiftEffect,
  estimateRoute,
  snapshotState,
  restoreState,
  DEFAULT_THRESHOLDS,
} from './engine';
import type { ScenarioScript } from '@idol/shared';

// ---------- ヘルパ ----------

const minimal: ScenarioScript = {
  version: 1,
  startSceneKey: 'a',
  scenes: {
    a: {
      steps: [
        { type: 'say', speaker: 'him', text: 'hello' },
        { type: 'end' },
      ],
    },
  },
};

const branching: ScenarioScript = {
  version: 1,
  startSceneKey: 'opening',
  scenes: {
    opening: {
      background: 'bg_room',
      bgm: 'bgm_calm',
      steps: [
        { type: 'narration', text: 'intro' },
        {
          type: 'choice',
          prompt: 'どう答える?',
          choices: [
            {
              label: 'A',
              effects: [{ type: 'affinity', delta: 5 }],
              next: 'happy',
            },
            {
              label: 'B',
              effects: [{ type: 'affinity', delta: -3 }],
              next: 'sad',
            },
            {
              label: 'C (require ring)',
              effects: [{ type: 'affinity', delta: 10 }],
              requireItemSlug: 'ring',
              next: 'happy',
            },
            {
              label: 'D (premium only)',
              effects: [{ type: 'affinity', delta: 8 }],
              premiumOnly: true,
              next: 'happy',
            },
          ],
        },
      ],
    },
    happy: {
      steps: [
        { type: 'say', speaker: 'him', text: 'glad' },
        {
          type: 'effect',
          effects: [{ type: 'route', result: 'LOVE_END' }],
        },
        { type: 'end' },
      ],
    },
    sad: {
      steps: [
        { type: 'say', speaker: 'him', text: 'sad' },
        { type: 'end' },
      ],
    },
  },
};

// ---------- createInitialState ----------

describe('createInitialState', () => {
  it('script の startSceneKey で初期化される', () => {
    const s = createInitialState(minimal);
    expect(s.sceneKey).toBe('a');
    expect(s.stepIndex).toBe(0);
    expect(s.affinity).toBe(0);
    expect(s.flags).toEqual({});
    expect(s.routeResult).toBe('IN_PROGRESS');
    expect(s.isEnded).toBe(false);
  });
  it('override で値を上書きできる', () => {
    const s = createInitialState(minimal, { affinity: 50, flags: { x: true } });
    expect(s.affinity).toBe(50);
    expect(s.flags).toEqual({ x: true });
  });
});

// ---------- evaluateCondition ----------

describe('evaluateCondition', () => {
  const state = createInitialState(minimal, { affinity: 50, flags: { friend: true, count: 3 } });
  it('affinity gte', () => {
    expect(evaluateCondition({ kind: 'affinity', op: 'gte', value: 50 }, state)).toBe(true);
    expect(evaluateCondition({ kind: 'affinity', op: 'gte', value: 51 }, state)).toBe(false);
  });
  it('affinity lt / gt / eq / lte', () => {
    expect(evaluateCondition({ kind: 'affinity', op: 'lt', value: 51 }, state)).toBe(true);
    expect(evaluateCondition({ kind: 'affinity', op: 'gt', value: 49 }, state)).toBe(true);
    expect(evaluateCondition({ kind: 'affinity', op: 'eq', value: 50 }, state)).toBe(true);
    expect(evaluateCondition({ kind: 'affinity', op: 'lte', value: 50 }, state)).toBe(true);
    expect(evaluateCondition({ kind: 'affinity', op: 'lte', value: 49 }, state)).toBe(false);
  });
  it('flag eq / neq', () => {
    expect(evaluateCondition({ kind: 'flag', key: 'friend', op: 'eq', value: true }, state)).toBe(true);
    expect(evaluateCondition({ kind: 'flag', key: 'friend', op: 'neq', value: false }, state)).toBe(true);
    expect(evaluateCondition({ kind: 'flag', key: 'count', op: 'eq', value: 3 }, state)).toBe(true);
    expect(evaluateCondition({ kind: 'flag', key: 'missing', op: 'eq', value: true }, state)).toBe(false);
  });
});

describe('evaluateAll', () => {
  const state = createInitialState(minimal, { affinity: 60 });
  it('undefined / 空配列 = true', () => {
    expect(evaluateAll(undefined, state)).toBe(true);
    expect(evaluateAll([], state)).toBe(true);
  });
  it('全て真で true', () => {
    expect(
      evaluateAll(
        [
          { kind: 'affinity', op: 'gte', value: 50 },
          { kind: 'affinity', op: 'lt', value: 100 },
        ],
        state,
      ),
    ).toBe(true);
  });
  it('1 つでも偽で false', () => {
    expect(
      evaluateAll(
        [
          { kind: 'affinity', op: 'gte', value: 50 },
          { kind: 'affinity', op: 'gte', value: 100 },
        ],
        state,
      ),
    ).toBe(false);
  });
});

// ---------- applyEffects (clamp 含む) ----------

describe('applyEffects', () => {
  it('affinity を加算', () => {
    const s = createInitialState(minimal, { affinity: 30 });
    const r = applyEffects([{ type: 'affinity', delta: 5 }], s);
    expect(r.next.affinity).toBe(35);
    expect(r.next).not.toBe(s); // immutable
  });
  it('affinity は 0 でクランプ', () => {
    const s = createInitialState(minimal, { affinity: 3 });
    const r = applyEffects([{ type: 'affinity', delta: -10 }], s);
    expect(r.next.affinity).toBe(0);
  });
  it('affinity は 100 でクランプ', () => {
    const s = createInitialState(minimal, { affinity: 95 });
    const r = applyEffects([{ type: 'affinity', delta: 20 }], s);
    expect(r.next.affinity).toBe(100);
  });
  it('flag を設定', () => {
    const s = createInitialState(minimal);
    const r = applyEffects([{ type: 'flag', key: 'met', value: true }], s);
    expect(r.next.flags).toEqual({ met: true });
  });
  it('route 変更で route_changed action が出る', () => {
    const s = createInitialState(minimal);
    const r = applyEffects([{ type: 'route', result: 'LOVE_END' }], s);
    expect(r.next.routeResult).toBe('LOVE_END');
    expect(r.actions).toContainEqual({ type: 'route_changed', result: 'LOVE_END' });
  });
  it('同じ route への変更ではアクションは出ない', () => {
    const s = createInitialState(minimal, { routeResult: 'LOVE_END' });
    const r = applyEffects([{ type: 'route', result: 'LOVE_END' }], s);
    expect(r.actions).toHaveLength(0);
  });
  it('複数エフェクトを順に適用', () => {
    const s = createInitialState(minimal);
    const r = applyEffects(
      [
        { type: 'affinity', delta: 10 },
        { type: 'affinity', delta: 5 },
        { type: 'flag', key: 'foo', value: 'bar' },
      ],
      s,
    );
    expect(r.next.affinity).toBe(15);
    expect(r.next.flags).toEqual({ foo: 'bar' });
  });
  it('unlock_scene は __unlocked.* フラグを立てる', () => {
    const s = createInitialState(minimal);
    const r = applyEffects([{ type: 'unlock_scene', sceneKey: 'secret' }], s);
    expect(r.next.flags['__unlocked.secret']).toBe(true);
  });
});

// ---------- buildChoiceViews (hidden / locked) ----------

describe('buildChoiceViews', () => {
  const step = branching.scenes.opening!.steps[1] as Extract<
    (typeof branching.scenes.opening.steps)[number],
    { type: 'choice' }
  >;
  it('所持アイテム不足で locked', () => {
    const views = buildChoiceViews(step, createInitialState(branching), {
      ownedItemSlugs: new Set(),
      isPremium: false,
    });
    expect(views[2]?.locked).toBe(true);
    expect(views[2]?.lockReason).toBe('requireItem');
  });
  it('所持していれば unlock', () => {
    const views = buildChoiceViews(step, createInitialState(branching), {
      ownedItemSlugs: new Set(['ring']),
      isPremium: false,
    });
    expect(views[2]?.locked).toBe(false);
  });
  it('PREMIUM 会員のみで locked', () => {
    const views = buildChoiceViews(step, createInitialState(branching), {
      ownedItemSlugs: new Set(),
      isPremium: false,
    });
    expect(views[3]?.locked).toBe(true);
    expect(views[3]?.lockReason).toBe('premiumOnly');
  });
  it('PREMIUM 会員で unlock', () => {
    const views = buildChoiceViews(step, createInitialState(branching), {
      ownedItemSlugs: new Set(),
      isPremium: true,
    });
    expect(views[3]?.locked).toBe(false);
  });
});

// ---------- advance (state machine) ----------

describe('advance', () => {
  it('初回呼び出しで開始シーンの background/bgm が action に出る', () => {
    const s = createInitialState(branching);
    const r = advance(branching, s, {}, { firstCall: true });
    expect(r.actions).toContainEqual({ type: 'set_background', key: 'bg_room' });
    expect(r.actions).toContainEqual({ type: 'set_bgm', key: 'bgm_calm' });
  });
  it('narration / say / choice で停止する', () => {
    const s = createInitialState(branching);
    const r = advance(branching, s);
    expect(r.step?.type).toBe('narration');
  });
  it('end ステップで isEnded = true', () => {
    const script: ScenarioScript = {
      version: 1,
      startSceneKey: 'a',
      scenes: { a: { steps: [{ type: 'end' }] } },
    };
    const s = createInitialState(script);
    const r = advance(script, s);
    expect(r.state.isEnded).toBe(true);
    expect(r.actions).toContainEqual({ type: 'ended' });
  });
  it('jump がシーン切替をする', () => {
    const script: ScenarioScript = {
      version: 1,
      startSceneKey: 'a',
      scenes: {
        a: { steps: [{ type: 'jump', next: 'b' }] },
        b: {
          background: 'bg_b',
          steps: [{ type: 'narration', text: 'hi' }],
        },
      },
    };
    const r = advance(script, createInitialState(script));
    expect(r.state.sceneKey).toBe('b');
    expect(r.actions).toContainEqual({ type: 'set_background', key: 'bg_b' });
  });
  it('branch が条件で分岐する', () => {
    const script: ScenarioScript = {
      version: 1,
      startSceneKey: 'a',
      scenes: {
        a: {
          steps: [
            {
              type: 'branch',
              branches: [
                { when: [{ kind: 'affinity', op: 'gte', value: 50 }], next: 'high' },
              ],
              else: 'low',
            },
          ],
        },
        high: { steps: [{ type: 'narration', text: 'high' }] },
        low: { steps: [{ type: 'narration', text: 'low' }] },
      },
    };
    const high = advance(script, createInitialState(script, { affinity: 80 }));
    expect(high.state.sceneKey).toBe('high');
    const low = advance(script, createInitialState(script, { affinity: 10 }));
    expect(low.state.sceneKey).toBe('low');
  });
  it('無限ループしても SAFETY_LIMIT で止まる', () => {
    const script: ScenarioScript = {
      version: 1,
      startSceneKey: 'a',
      scenes: {
        a: { steps: [{ type: 'jump', next: 'b' }] },
        b: { steps: [{ type: 'jump', next: 'a' }] },
      },
    };
    // 例外を吐かないこと
    expect(() => advance(script, createInitialState(script))).not.toThrow();
  });
  it('shake / flash アクションを発火する', () => {
    const script: ScenarioScript = {
      version: 1,
      startSceneKey: 'a',
      scenes: {
        a: {
          steps: [
            { type: 'shake', intensity: 'heavy', durationMs: 800 },
            { type: 'flash', color: '#fff', durationMs: 200 },
            { type: 'narration', text: 'after' },
          ],
        },
      },
    };
    const r = advance(script, createInitialState(script));
    expect(r.actions.find((a) => a.type === 'shake')).toMatchObject({
      type: 'shake',
      intensity: 'heavy',
      durationMs: 800,
    });
    expect(r.actions.find((a) => a.type === 'flash')).toMatchObject({
      type: 'flash',
      color: '#fff',
    });
  });
});

// ---------- selectChoice ----------

describe('selectChoice', () => {
  it('選択肢を選んでエフェクト適用 + シーン遷移', () => {
    const s = createInitialState(branching);
    // choice ステップまで進める
    const r1 = advance(branching, s);
    const r2 = advance(branching, { ...r1.state, stepIndex: r1.state.stepIndex + 1 });
    // 0 = +5 (next: happy)
    const r3 = selectChoice(branching, r2.state, 0);
    expect(r3.state.sceneKey).toBe('happy');
    expect(r3.state.affinity).toBe(5);
  });
  it('範囲外インデックスは無視される', () => {
    const s = createInitialState(branching);
    const r1 = advance(branching, s);
    const r2 = advance(branching, { ...r1.state, stepIndex: r1.state.stepIndex + 1 });
    const r3 = selectChoice(branching, r2.state, 99);
    expect(r3.state).toEqual(r2.state);
  });
});

// ---------- applyGiftEffect ----------

describe('applyGiftEffect', () => {
  it('親密度を加算 + クランプ', () => {
    const s = createInitialState(minimal, { affinity: 90 });
    const r = applyGiftEffect(s, 30);
    expect(r.state.affinity).toBe(100);
  });
  it('負の値も受け付ける (将来の罰則用)', () => {
    const s = createInitialState(minimal, { affinity: 5 });
    const r = applyGiftEffect(s, -10);
    expect(r.state.affinity).toBe(0);
  });
});

// ---------- estimateRoute ----------

describe('estimateRoute', () => {
  it('閾値超で LOVE_END / FRIEND_END / IN_PROGRESS', () => {
    expect(estimateRoute(createInitialState(minimal, { affinity: 80 }))).toBe('LOVE_END');
    expect(estimateRoute(createInitialState(minimal, { affinity: 50 }))).toBe('FRIEND_END');
    expect(estimateRoute(createInitialState(minimal, { affinity: 20 }))).toBe('IN_PROGRESS');
  });
  it('既に確定した route は維持', () => {
    expect(
      estimateRoute(createInitialState(minimal, { affinity: 0, routeResult: 'LOVE_END' })),
    ).toBe('LOVE_END');
  });
  it('閾値はカスタマイズできる', () => {
    expect(
      estimateRoute(createInitialState(minimal, { affinity: 50 }), {
        loveMin: 30,
        friendMin: 10,
      }),
    ).toBe('LOVE_END');
  });
  it('DEFAULT_THRESHOLDS は loveMin:70, friendMin:40', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ loveMin: 70, friendMin: 40 });
  });
});

// ---------- snapshot / restore ----------

describe('snapshot/restore', () => {
  it('round-trip でデータが保たれる', () => {
    const s = createInitialState(minimal, {
      sceneKey: 'b',
      stepIndex: 3,
      affinity: 42,
      flags: { foo: 1, bar: 'x' },
    });
    const snap = snapshotState('scenario-1', s);
    expect(snap.scenarioId).toBe('scenario-1');
    expect(snap.sceneKey).toBe('b');
    expect(snap.affinity).toBe(42);
    const restored = restoreState(snap);
    expect(restored.sceneKey).toBe('b');
    expect(restored.stepIndex).toBe(3);
    expect(restored.affinity).toBe(42);
    expect(restored.flags).toEqual({ foo: 1, bar: 'x' });
  });
  it('スナップショットは flags を deep-copy する', () => {
    const s = createInitialState(minimal, { flags: { a: 1 } });
    const snap = snapshotState('id', s);
    s.flags['a'] = 999;
    expect(snap.flags['a']).toBe(1);
  });
});
