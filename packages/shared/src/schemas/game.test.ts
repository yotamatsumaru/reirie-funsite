/**
 * シナリオ DSL バリデーションテスト
 */
import {
  ScenarioScriptSchema,
  validateScenarioScript,
  AdminGameCharacterInputSchema,
  AdminGameScenarioInputSchema,
  AdminGameItemInputSchema,
  GamePurchaseInputSchema,
  GiftUseInputSchema,
} from './game';

describe('ScenarioScriptSchema', () => {
  it('最小構成を受理', () => {
    const r = ScenarioScriptSchema.safeParse({
      version: 1,
      startSceneKey: 'a',
      scenes: {
        a: { steps: [{ type: 'narration', text: 'hi' }] },
      },
    });
    expect(r.success).toBe(true);
  });

  it('version != 1 は拒否', () => {
    const r = ScenarioScriptSchema.safeParse({
      version: 2,
      startSceneKey: 'a',
      scenes: { a: { steps: [{ type: 'end' }] } },
    });
    expect(r.success).toBe(false);
  });

  it('全 step type を受理', () => {
    const r = ScenarioScriptSchema.safeParse({
      version: 1,
      startSceneKey: 'a',
      scenes: {
        a: {
          steps: [
            { type: 'say', speaker: 'h', text: 't' },
            { type: 'narration', text: 't' },
            {
              type: 'choice',
              choices: [{ label: 'A', effects: [{ type: 'affinity', delta: 1 }] }],
            },
            { type: 'background', key: 'bg' },
            { type: 'bgm', key: 'b1' },
            { type: 'bgm', key: null }, // null で停止
            { type: 'se', key: 'se1' },
            { type: 'cg', key: 'cg1' },
            { type: 'effect', effects: [{ type: 'flag', key: 'x', value: true }] },
            { type: 'jump', next: 'a' },
            {
              type: 'branch',
              branches: [
                { when: [{ kind: 'affinity', op: 'gte', value: 10 }], next: 'a' },
              ],
            },
            { type: 'shake' }, // default values
            { type: 'flash' },
            { type: 'end' },
          ],
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it('affinity delta は -100..100 の整数', () => {
    const tooBig = ScenarioScriptSchema.safeParse({
      version: 1,
      startSceneKey: 'a',
      scenes: {
        a: {
          steps: [{ type: 'effect', effects: [{ type: 'affinity', delta: 200 }] }],
        },
      },
    });
    expect(tooBig.success).toBe(false);
  });
});

describe('validateScenarioScript', () => {
  it('整合性 OK', () => {
    const r = validateScenarioScript({
      version: 1,
      startSceneKey: 'a',
      scenes: {
        a: {
          steps: [
            { type: 'jump', next: 'b' },
          ],
        },
        b: { steps: [{ type: 'end' }] },
      },
    });
    expect(r.ok).toBe(true);
  });

  it('startSceneKey が存在しない場合エラー', () => {
    const r = validateScenarioScript({
      version: 1,
      startSceneKey: 'missing',
      scenes: { a: { steps: [{ type: 'end' }] } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('startSceneKey'))).toBe(true);
  });

  it('jump 先のシーンが存在しない場合エラー', () => {
    const r = validateScenarioScript({
      version: 1,
      startSceneKey: 'a',
      scenes: { a: { steps: [{ type: 'jump', next: 'ghost' }] } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('ghost'))).toBe(true);
  });

  it('choice.next の存在チェック', () => {
    const r = validateScenarioScript({
      version: 1,
      startSceneKey: 'a',
      scenes: {
        a: {
          steps: [
            {
              type: 'choice',
              choices: [{ label: 'X', effects: [], next: 'phantom' }],
            },
          ],
        },
      },
    });
    expect(r.ok).toBe(false);
  });

  it('branch.next / branch.else の存在チェック', () => {
    const r = validateScenarioScript({
      version: 1,
      startSceneKey: 'a',
      scenes: {
        a: {
          steps: [
            {
              type: 'branch',
              branches: [
                { when: [{ kind: 'affinity', op: 'gte', value: 10 }], next: 'nope' },
              ],
              else: 'also-nope',
            },
          ],
        },
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('nope'))).toBe(true);
      expect(r.errors.some((e) => e.includes('also-nope'))).toBe(true);
    }
  });

  it('Zod 構文エラーをそのまま返す', () => {
    const r = validateScenarioScript({ version: 1 });
    expect(r.ok).toBe(false);
  });
});

describe('Admin schemas', () => {
  it('GameCharacter slug は kebab-case のみ', () => {
    const ok = AdminGameCharacterInputSchema.safeParse({ slug: 'hiroto-1', name: 'X' });
    expect(ok.success).toBe(true);
    const ng = AdminGameCharacterInputSchema.safeParse({ slug: 'Bad Slug!', name: 'X' });
    expect(ng.success).toBe(false);
  });

  it('GameCharacter デフォルト値が設定される', () => {
    const r = AdminGameCharacterInputSchema.parse({ slug: 'a', name: 'A' });
    expect(r.status).toBe('DRAFT');
    expect(r.affinityMax).toBe(100);
    expect(r.isPremiumOnly).toBe(false);
  });

  it('GameScenario.scriptJson は unknown (別途検証)', () => {
    const r = AdminGameScenarioInputSchema.safeParse({
      characterId: '00000000-0000-0000-0000-000000000000',
      slug: 'ch1',
      chapterNumber: 1,
      title: 'X',
      scriptJson: { 任意の: 'JSON' },
    });
    expect(r.success).toBe(true);
  });

  it('GameItem.affinityBoost は 0..50', () => {
    const ok = AdminGameItemInputSchema.safeParse({
      slug: 'gift',
      kind: 'GIFT',
      name: 'Gift',
      priceJpy: 100,
      affinityBoost: 10,
    });
    expect(ok.success).toBe(true);
    const ng = AdminGameItemInputSchema.safeParse({
      slug: 'gift',
      kind: 'GIFT',
      name: 'Gift',
      priceJpy: 100,
      affinityBoost: 999,
    });
    expect(ng.success).toBe(false);
  });
});

describe('API input schemas', () => {
  it('GamePurchaseInput.kind は SCENARIO / ITEM', () => {
    const ok = GamePurchaseInputSchema.safeParse({
      kind: 'SCENARIO',
      scenarioId: '550e8400-e29b-41d4-a716-446655440000',
      successUrl: 'https://example.com/s',
      cancelUrl: 'https://example.com/c',
    });
    expect(ok.success).toBe(true);
    const ng = GamePurchaseInputSchema.safeParse({
      kind: 'WRONG',
      successUrl: 'https://example.com/s',
      cancelUrl: 'https://example.com/c',
    });
    expect(ng.success).toBe(false);
  });

  it('GiftUseInput は characterId + itemId 必須', () => {
    const ng = GiftUseInputSchema.safeParse({
      characterId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(ng.success).toBe(false);
    const ok = GiftUseInputSchema.safeParse({
      characterId: '550e8400-e29b-41d4-a716-446655440000',
      itemId: '550e8400-e29b-41d4-a716-446655440001',
    });
    expect(ok.success).toBe(true);
  });
});
