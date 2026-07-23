import { z } from 'zod';

// =====================================================================
// シナリオ DSL — JSON で記述するシナリオの構造定義
// =====================================================================
//
// シナリオは「シーン」の集合であり、各シーンは「ステップ」の配列。
// ステップには台詞 / ナレーション / 選択肢 / エフェクト等がある。
// 状態 (親密度・フラグ) は ScenarioRunner が管理し、condition で参照可能。
//
// 例:
// {
//   "version": 1,
//   "startSceneKey": "opening",
//   "scenes": {
//     "opening": {
//       "background": "bg_classroom",
//       "bgm": "bgm_calm",
//       "steps": [
//         { "type": "say", "speaker": "him", "expression": "smile",
//           "text": "やあ、今日も来てくれたんだね。" },
//         { "type": "narration", "text": "彼は嬉しそうに微笑んだ。" },
//         { "type": "choice", "prompt": "どう答える？", "choices": [
//             { "label": "もちろん！", "effects": [{"type":"affinity","delta":3}],
//               "next": "happy_path" },
//             { "label": "…うん", "effects": [{"type":"affinity","delta":1}],
//               "next": "neutral_path" }
//         ]},
//         { "type": "jump", "next": "ending" }
//       ]
//     }
//   }
// }

// ---------- エフェクト (ゲーム状態への変化) ----------

export const AffinityEffectSchema = z.object({
  type: z.literal('affinity'),
  delta: z.number().int().min(-100).max(100),
});

export const FlagEffectSchema = z.object({
  type: z.literal('flag'),
  key: z.string().min(1).max(64),
  value: z.union([z.boolean(), z.number(), z.string()]),
});

export const RouteEffectSchema = z.object({
  type: z.literal('route'),
  result: z.enum(['IN_PROGRESS', 'FRIEND_END', 'LOVE_END', 'SPECIAL_END', 'BAD_END']),
});

export const UnlockSceneEffectSchema = z.object({
  type: z.literal('unlock_scene'),
  sceneKey: z.string().min(1),
});

export const EffectSchema = z.discriminatedUnion('type', [
  AffinityEffectSchema,
  FlagEffectSchema,
  RouteEffectSchema,
  UnlockSceneEffectSchema,
]);

export type Effect = z.infer<typeof EffectSchema>;

// ---------- 条件式 (シーン分岐) ----------
// 親密度や flag を参照して条件分岐させる

export const AffinityConditionSchema = z.object({
  kind: z.literal('affinity'),
  op: z.enum(['gte', 'lte', 'eq', 'gt', 'lt']),
  value: z.number().int(),
});

export const FlagConditionSchema = z.object({
  kind: z.literal('flag'),
  key: z.string().min(1).max(64),
  op: z.enum(['eq', 'neq']),
  value: z.union([z.boolean(), z.number(), z.string()]),
});

export const ConditionSchema = z.discriminatedUnion('kind', [
  AffinityConditionSchema,
  FlagConditionSchema,
]);

export type Condition = z.infer<typeof ConditionSchema>;

// ---------- 選択肢 ----------

export const ChoiceSchema = z.object({
  /** 表示ラベル */
  label: z.string().min(1).max(120),
  /** クリック時のエフェクト (親密度変動など) */
  effects: z.array(EffectSchema).default([]),
  /** 次のシーンキー (省略時は次ステップへ) */
  next: z.string().min(1).optional(),
  /** 表示条件 (満たさなければ非表示) */
  showIf: z.array(ConditionSchema).optional(),
  /** 課金アイテムが必要な選択肢 (例: 高級プレゼント) */
  requireItemSlug: z.string().optional(),
  /** PREMIUM 会員のみ */
  premiumOnly: z.boolean().optional(),
});

export type Choice = z.infer<typeof ChoiceSchema>;

// ---------- ステップ (シーン内の 1 単位) ----------

/** 台詞 */
export const SayStepSchema = z.object({
  type: z.literal('say'),
  /** 話者キー — "you" / "him" / 任意のキャラ key */
  speaker: z.string().min(1).max(32),
  /** 立ち絵の表情 key (GameAsset.key) */
  expression: z.string().optional(),
  /** 台詞本文 */
  text: z.string().min(1),
  /** ボイス再生用 GameAsset.key (省略可) */
  voiceKey: z.string().optional(),
});

/** ナレーション (話者なし) */
export const NarrationStepSchema = z.object({
  type: z.literal('narration'),
  text: z.string().min(1),
});

/** 選択肢 */
export const ChoiceStepSchema = z.object({
  type: z.literal('choice'),
  prompt: z.string().optional(),
  choices: z.array(ChoiceSchema).min(1).max(6),
});

/** 背景切替 */
export const BackgroundStepSchema = z.object({
  type: z.literal('background'),
  key: z.string().min(1),
  fade: z.boolean().optional(),
});

/** BGM 切替 */
export const BgmStepSchema = z.object({
  type: z.literal('bgm'),
  key: z.string().nullable(), // null で停止
  volume: z.number().min(0).max(1).optional(),
});

/** 効果音 */
export const SeStepSchema = z.object({
  type: z.literal('se'),
  key: z.string().min(1),
});

/** CG 表示 (フルスクリーン画像) */
export const CgStepSchema = z.object({
  type: z.literal('cg'),
  key: z.string().min(1),
  durationMs: z.number().int().min(100).max(60_000).optional(),
});

/** エフェクトのみ実行 (親密度操作・フラグ立て) */
export const EffectStepSchema = z.object({
  type: z.literal('effect'),
  effects: z.array(EffectSchema).min(1),
});

/** ジャンプ (次シーンへ) */
export const JumpStepSchema = z.object({
  type: z.literal('jump'),
  next: z.string().min(1),
});

/** 条件分岐 */
export const BranchStepSchema = z.object({
  type: z.literal('branch'),
  branches: z
    .array(
      z.object({
        when: z.array(ConditionSchema).min(1),
        next: z.string().min(1),
      }),
    )
    .min(1),
  /** どの when にも合致しなかった場合のジャンプ先 */
  else: z.string().min(1).optional(),
});

/** 章クリア (次の章への進行を許可) */
export const EndStepSchema = z.object({
  type: z.literal('end'),
  /** クリア時のエンディング判定エフェクト (省略時は IN_PROGRESS のまま) */
  effects: z.array(EffectSchema).optional(),
});

/** 演出: 画面シェイク (告白シーン等) */
export const ShakeStepSchema = z.object({
  type: z.literal('shake'),
  intensity: z.enum(['light', 'medium', 'heavy']).default('medium'),
  durationMs: z.number().int().min(100).max(5000).default(500),
});

/** 演出: フラッシュ */
export const FlashStepSchema = z.object({
  type: z.literal('flash'),
  color: z.string().default('#ffffff'),
  durationMs: z.number().int().min(100).max(2000).default(300),
});

export const StepSchema = z.discriminatedUnion('type', [
  SayStepSchema,
  NarrationStepSchema,
  ChoiceStepSchema,
  BackgroundStepSchema,
  BgmStepSchema,
  SeStepSchema,
  CgStepSchema,
  EffectStepSchema,
  JumpStepSchema,
  BranchStepSchema,
  EndStepSchema,
  ShakeStepSchema,
  FlashStepSchema,
]);

export type Step = z.infer<typeof StepSchema>;

// ---------- シーン ----------

export const SceneSchema = z.object({
  /** シーン入場時のデフォルト背景 */
  background: z.string().optional(),
  /** シーン入場時の BGM */
  bgm: z.string().optional(),
  steps: z.array(StepSchema).min(1).max(500),
});

export type Scene = z.infer<typeof SceneSchema>;

// ---------- シナリオ DSL ルート ----------

export const ScenarioScriptSchema = z.object({
  version: z.literal(1),
  /** 起点シーンの key */
  startSceneKey: z.string().min(1),
  /** シーンマップ (key → Scene) */
  scenes: z.record(z.string().min(1), SceneSchema),
  /** メタ情報 (任意) */
  meta: z
    .object({
      author: z.string().optional(),
      writtenAt: z.string().optional(),
      revision: z.number().int().optional(),
    })
    .optional(),
});

export type ScenarioScript = z.infer<typeof ScenarioScriptSchema>;

/**
 * シナリオを検証 (整合性チェック含む)
 * - startSceneKey が scenes に存在すること
 * - jump/branch/choice の next 先が全て存在すること
 */
export function validateScenarioScript(input: unknown):
  | { ok: true; script: ScenarioScript }
  | { ok: false; errors: string[] } {
  const parsed = ScenarioScriptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const script = parsed.data;
  const errors: string[] = [];
  const sceneKeys = new Set(Object.keys(script.scenes));

  if (!sceneKeys.has(script.startSceneKey)) {
    errors.push(`startSceneKey "${script.startSceneKey}" が scenes に存在しません`);
  }

  for (const [key, scene] of Object.entries(script.scenes)) {
    scene.steps.forEach((step, i) => {
      const ctx = `scene[${key}].steps[${i}]`;
      if (step.type === 'jump' && !sceneKeys.has(step.next)) {
        errors.push(`${ctx}: jump 先 "${step.next}" が存在しません`);
      }
      if (step.type === 'branch') {
        for (const b of step.branches) {
          if (!sceneKeys.has(b.next)) {
            errors.push(`${ctx}: branch.next "${b.next}" が存在しません`);
          }
        }
        if (step.else && !sceneKeys.has(step.else)) {
          errors.push(`${ctx}: branch.else "${step.else}" が存在しません`);
        }
      }
      if (step.type === 'choice') {
        step.choices.forEach((c, j) => {
          if (c.next && !sceneKeys.has(c.next)) {
            errors.push(`${ctx}.choices[${j}]: next "${c.next}" が存在しません`);
          }
        });
      }
    });
  }

  return errors.length === 0 ? { ok: true, script } : { ok: false, errors };
}

// =====================================================================
// API リクエスト/レスポンス
// =====================================================================

/** プレイヤー進捗の保存 */
export const SaveProgressInputSchema = z.object({
  characterId: z.uuid(),
  scenarioId: z.uuid().optional(),
  sceneKey: z.string().optional(),
  affinity: z.number().int().min(0).max(100).optional(),
  flags: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).optional(),
  routeResult: z
    .enum(['IN_PROGRESS', 'FRIEND_END', 'LOVE_END', 'SPECIAL_END', 'BAD_END'])
    .optional(),
  playMinutesDelta: z.number().int().min(0).max(360).optional(),
});

export type SaveProgressInput = z.infer<typeof SaveProgressInputSchema>;

/** セーブスロット書き込み */
export const SaveSlotInputSchema = z.object({
  characterId: z.uuid(),
  slotIndex: z.number().int().min(0).max(4),
  label: z.string().max(60).optional(),
  snapshot: z.object({
    scenarioId: z.uuid(),
    sceneKey: z.string().min(1),
    stepIndex: z.number().int().min(0),
    affinity: z.number().int().min(0).max(100),
    flags: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).default({}),
  }),
});

export type SaveSlotInput = z.infer<typeof SaveSlotInputSchema>;

/** プレゼント使用 */
export const GiftUseInputSchema = z.object({
  characterId: z.uuid(),
  itemId: z.uuid(),
});

export type GiftUseInput = z.infer<typeof GiftUseInputSchema>;

/** 章購入 / アイテム購入 */
export const GamePurchaseInputSchema = z
  .object({
    kind: z.enum(['SCENARIO', 'ITEM']),
    scenarioId: z.uuid().optional(),
    itemId: z.uuid().optional(),
    quantity: z.number().int().min(1).max(99).default(1),
    // 決済手段。STRIPE (既定) = クレジットカード課金 / PUI = Pui 即時消費。
    // successUrl/cancelUrl は STRIPE のときのみ必須 (PUI は即時確定するため不要)。
    payMethod: z.enum(['STRIPE', 'PUI']).default('STRIPE'),
    successUrl: z.url().optional(),
    cancelUrl: z.url().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.payMethod === 'STRIPE') {
      if (!val.successUrl) {
        ctx.addIssue({ code: 'custom', path: ['successUrl'], message: 'successUrl が必要です' });
      }
      if (!val.cancelUrl) {
        ctx.addIssue({ code: 'custom', path: ['cancelUrl'], message: 'cancelUrl が必要です' });
      }
    }
  });

export type GamePurchaseInput = z.infer<typeof GamePurchaseInputSchema>;

// =====================================================================
// 管理画面用 (キャラ・シナリオ・アイテム CRUD)
// =====================================================================

export const AdminGameCharacterInputSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'slug は半角英数とハイフンのみ'),
  name: z.string().min(1).max(60),
  furigana: z.string().max(60).optional(),
  catchcopy: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  age: z.number().int().min(0).max(100).optional(),
  birthday: z
    .string()
    .regex(/^\d{2}-\d{2}$/, 'MM-DD 形式')
    .optional(),
  bloodType: z.enum(['A', 'B', 'O', 'AB']).optional(),
  height: z.number().int().min(50).max(250).optional(),
  portraitUrl: z.url().optional(),
  spriteUrl: z.url().optional(),
  themeColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB 形式')
    .optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isPremiumOnly: z.boolean().default(false),
  affinityMax: z.number().int().min(10).max(1000).default(100),
});

export type AdminGameCharacterInput = z.infer<typeof AdminGameCharacterInputSchema>;

export const AdminGameScenarioInputSchema = z.object({
  characterId: z.uuid(),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  chapterNumber: z.number().int().min(1).max(999),
  title: z.string().min(1).max(120),
  summary: z.string().max(2000).optional(),
  scriptJson: z.unknown(), // 別途 validateScenarioScript で検証
  priceJpy: z.number().int().min(0).max(50_000).default(0),
  // Pui での購入 (null/未指定 = Pui 購入不可、Stripe 課金のみ)
  puiPrice: z.number().int().min(1).max(1_000_000).nullable().optional(),
  isFreeTrial: z.boolean().default(false),
  isPremiumIncluded: z.boolean().default(false),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
  requiredAffinity: z.number().int().min(0).max(100).default(0),
  estimatedMinutes: z.number().int().min(1).max(600).optional(),
});

export type AdminGameScenarioInput = z.infer<typeof AdminGameScenarioInputSchema>;

export const AdminGameItemInputSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  characterId: z.uuid().nullable().optional(),
  kind: z.enum(['GIFT', 'COSMETIC', 'CG_PACK', 'VOICE_PACK']),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  iconUrl: z.url().optional(),
  priceJpy: z.number().int().min(0).max(50_000),
  // Pui での購入 (null/未指定 = Pui 購入不可、Stripe 課金のみ)
  puiPrice: z.number().int().min(1).max(1_000_000).nullable().optional(),
  isPremiumOnly: z.boolean().default(false),
  affinityBoost: z.number().int().min(0).max(50).default(0),
  maxOwn: z.number().int().min(1).max(99).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export type AdminGameItemInput = z.infer<typeof AdminGameItemInputSchema>;
