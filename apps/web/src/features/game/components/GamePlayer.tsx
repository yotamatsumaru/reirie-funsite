/**
 * ゲームプレイヤー (組合せコンポーネント)
 *
 * - 背景 / 立ち絵 / テキスト or 選択肢 / 上部コマンドバー / プレゼント
 * - 副作用 (BGM/SE/シェイク) はストアの pendingActions を消化
 * - 親 page から validate 済の script と "アセット解決マップ" を受け取る
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ScenarioScript } from '@idol/shared';
import { useGameStore } from '../engine/store';
import { Background } from './Background';
import { Sprite } from './Sprite';
import { TextWindow } from './TextWindow';
import { ChoicePanel } from './ChoicePanel';
import { CommandMenu } from './CommandMenu';
import { GiftPanel, type GiftItem } from './GiftPanel';
import { CgOverlay, FlashOverlay } from './EffectOverlay';

export interface GameAssetIndex {
  /** background key → URL */
  backgrounds: Record<string, string>;
  /** speaker(__expression) → URL */
  sprites: Record<string, string>;
  /** CG key → URL */
  cgs: Record<string, string>;
  /** BGM key → URL */
  bgms: Record<string, string>;
  /** SE key → URL */
  ses: Record<string, string>;
}

export interface GamePlayerProps {
  script: ScenarioScript;
  scenarioId: string;
  characterName: string;
  characterFallbackSpriteUrl?: string | null;
  assetIndex: GameAssetIndex;
  isPremium?: boolean;
  ownedItemSlugs?: string[];
  giftItems?: GiftItem[];
  onSave?: () => void;
  onClose?: () => void;
  onGiveGift?: (item: GiftItem) => Promise<void> | void;
  onBuyGift?: (item: GiftItem) => void;
  onScenarioEnded?: () => void;
}

export function GamePlayer({
  script,
  scenarioId,
  characterName,
  characterFallbackSpriteUrl,
  assetIndex,
  isPremium = false,
  ownedItemSlugs = [],
  giftItems = [],
  onSave,
  onClose,
  onGiveGift,
  onBuyGift,
  onScenarioEnded,
}: GamePlayerProps) {
  const {
    state,
    frame,
    pendingActions,
    shake,
    flash,
    cgKey,
    start,
    next,
    selectChoice,
    clearPendingActions,
    clearShake,
    clearFlash,
    clearCg,
    getEstimatedRoute,
  } = useGameStore();

  const [giftOpen, setGiftOpen] = useState(false);

  // 1) 起動: scenarioId が変わったらリスタート
  useEffect(() => {
    start(script, scenarioId, { isPremium, ownedItemSlugs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  // 2) アセット解決
  const resolveBg = (key: string) => assetIndex.backgrounds[key] ?? null;
  const resolveSprite = (speaker: string, expression?: string) => {
    if (expression) {
      return (
        assetIndex.sprites[`${speaker}__${expression}`] ??
        assetIndex.sprites[speaker] ??
        null
      );
    }
    return assetIndex.sprites[speaker] ?? null;
  };
  const resolveCg = (key: string) => assetIndex.cgs[key] ?? null;

  // 3) 副作用消化 (BGM / SE)
  useEffect(() => {
    if (pendingActions.length === 0) return;
    for (const a of pendingActions) {
      if (a.type === 'play_se') {
        playOnce(assetIndex.ses[a.key]);
      } else if (a.type === 'play_voice') {
        // ボイスは ses or 別マップ。簡易実装として ses から探す
        playOnce(assetIndex.ses[a.key]);
      } else if (a.type === 'set_bgm') {
        playBgm(a.key ? assetIndex.bgms[a.key] ?? null : null, a.volume ?? 0.5);
      } else if (a.type === 'ended') {
        onScenarioEnded?.();
      }
    }
    clearPendingActions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingActions]);

  // 4) シェイク class
  const shakeClass = useMemo(() => {
    if (!shake) return '';
    const map = { light: 'animate-shake-light', medium: 'animate-shake-medium', heavy: 'animate-shake-heavy' };
    return map[shake.intensity];
  }, [shake]);

  useEffect(() => {
    if (!shake) return;
    const t = setTimeout(clearShake, shake.durationMs);
    return () => clearTimeout(t);
  }, [shake, clearShake]);

  // 5) ルート推定ラベル
  const route = state ? getEstimatedRoute() : 'IN_PROGRESS';
  const routeLabel =
    route === 'LOVE_END'
      ? '♡ 恋愛ルート射程'
      : route === 'FRIEND_END'
        ? '友情ルート射程'
        : undefined;

  if (!state || !frame) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center bg-slate-900 text-white">
        <p className="text-sm">読み込み中…</p>
      </div>
    );
  }

  const step = frame.step;
  const isChoice = step?.type === 'choice';

  return (
    <div className={`relative h-[100dvh] w-full overflow-hidden bg-black ${shakeClass}`}>
      <Background bgKey={frame.background} resolveUrl={resolveBg} />
      <Sprite
        speaker={frame.activeSpeaker}
        expression={frame.activeExpression}
        resolveUrl={resolveSprite}
        fallbackUrl={characterFallbackSpriteUrl ?? null}
      />
      <FlashOverlay flash={flash} onDone={clearFlash} />
      <CgOverlay cgKey={cgKey} resolveUrl={resolveCg} onClose={clearCg} />

      <CommandMenu
        characterName={characterName}
        affinity={state.affinity}
        routeLabel={routeLabel}
        onOpenGift={giftItems.length > 0 ? () => setGiftOpen(true) : undefined}
        onSave={onSave}
        onClose={onClose}
      />

      {!isChoice && step && (step.type === 'say' || step.type === 'narration') && (
        <TextWindow step={step} onAdvance={next} />
      )}
      {isChoice && step?.type === 'choice' && frame.choices && (
        <ChoicePanel prompt={step.prompt} choices={frame.choices} onSelect={selectChoice} />
      )}

      <GiftPanel
        open={giftOpen}
        items={giftItems}
        onClose={() => setGiftOpen(false)}
        onGive={async (item) => {
          if (onGiveGift) await onGiveGift(item);
          setGiftOpen(false);
        }}
        onBuy={(item) => {
          onBuyGift?.(item);
        }}
      />
    </div>
  );
}

// ---------- 簡易オーディオ (Howler 不使用 — 標準 Audio API) ----------
let bgmAudio: HTMLAudioElement | null = null;
let bgmKey: string | null = null;
function playBgm(url: string | null, volume: number) {
  if (typeof window === 'undefined') return;
  if (url === bgmKey) return;
  if (bgmAudio) {
    try {
      bgmAudio.pause();
    } catch {
      /* noop */
    }
    bgmAudio = null;
  }
  bgmKey = url;
  if (!url) return;
  try {
    const a = new Audio(url);
    a.loop = true;
    a.volume = volume;
    void a.play().catch(() => {
      /* user gesture 未取得時のエラーは無視 */
    });
    bgmAudio = a;
  } catch {
    /* noop */
  }
}
function playOnce(url: string | undefined) {
  if (typeof window === 'undefined' || !url) return;
  try {
    const a = new Audio(url);
    a.volume = 0.6;
    void a.play().catch(() => {
      /* noop */
    });
  } catch {
    /* noop */
  }
}
