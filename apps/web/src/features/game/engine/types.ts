/**
 * ゲームエンジン共通型
 */
import type { ScenarioScript, Step, Effect, Condition } from '@idol/shared';

export type FlagValue = boolean | number | string;
export type FlagsMap = Record<string, FlagValue>;

export type RouteResult =
  | 'IN_PROGRESS'
  | 'FRIEND_END'
  | 'LOVE_END'
  | 'SPECIAL_END'
  | 'BAD_END';

/**
 * ランナーが管理するゲーム状態
 */
export interface GameState {
  /** 現在のシーンキー */
  sceneKey: string;
  /** シーン内のステップインデックス */
  stepIndex: number;
  /** 親密度 (0-100) */
  affinity: number;
  /** フラグ (シナリオで自由に使う) */
  flags: FlagsMap;
  /** ルート結果 */
  routeResult: RouteResult;
  /** クリア済みフラグ */
  isEnded: boolean;
}

/**
 * 表示中のフレーム情報 (UI に渡す)
 */
export interface CurrentFrame {
  /** 現在のシーンの背景キー (シーン入場時のもの) */
  background?: string;
  /** 現在の BGM キー */
  bgm?: string | null;
  /** 直近の表示中ステップ (UI で render する対象) */
  step: Step | null;
  /** 表示中の選択肢 (choice ステップ時のみ) */
  choices?: ChoiceView[];
  /** 直近の話者・表情 (sprite 表示用) */
  activeSpeaker?: string;
  activeExpression?: string;
}

export interface ChoiceView {
  /** choices 配列内のインデックス */
  index: number;
  label: string;
  /** showIf 条件を満たさないため非表示 */
  hidden: boolean;
  /** 課金 / プレミアム要件で disabled */
  locked: boolean;
  lockReason?: 'requireItem' | 'premiumOnly';
  /** 課金プレゼント要求 */
  requireItemSlug?: string;
  premiumOnly?: boolean;
}

/**
 * Engine が UI / 呼出元へ通知するアクション (副作用)
 */
export type EngineAction =
  | { type: 'play_se'; key: string }
  | { type: 'play_voice'; key: string }
  | { type: 'set_bgm'; key: string | null; volume?: number }
  | { type: 'set_background'; key: string; fade?: boolean }
  | { type: 'shake'; intensity: 'light' | 'medium' | 'heavy'; durationMs: number }
  | { type: 'flash'; color: string; durationMs: number }
  | { type: 'show_cg'; key: string; durationMs?: number }
  | { type: 'route_changed'; result: RouteResult }
  | { type: 'ended' };

export interface AdvanceContext {
  /** 課金/プレミアム判定用 */
  ownedItemSlugs?: Set<string>;
  isPremium?: boolean;
}

/**
 * フレーム描画用のコンテキスト (背景・BGM・話者を維持)
 * ストア側でシーン遷移をまたいでも残したい状態
 */
export interface FrameContext {
  background?: string;
  bgm?: string | null;
  activeSpeaker?: string;
  activeExpression?: string;
}

export type { ScenarioScript, Step, Effect, Condition };
