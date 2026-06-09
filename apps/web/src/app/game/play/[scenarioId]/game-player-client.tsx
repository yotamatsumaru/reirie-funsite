/**
 * Game player (client) — server から受け取ったデータで GamePlayer を起動
 *
 * - シナリオ終了時: PlayerProgress を保存し、ルート結果を表示
 * - プレゼント使用時: API で所持数 - 1 + 親密度加算 → ストアに反映
 * - 章購入: Checkout へ遷移
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ScenarioScript } from '@idol/shared';
import { GamePlayer, type GameAssetIndex } from '@/features/game/components/GamePlayer';
import type { GiftItem } from '@/features/game/components/GiftPanel';
import { useGameStore } from '@/features/game/engine/store';

interface Props {
  scenarioId: string;
  characterId: string;
  characterName: string;
  characterSlug: string;
  characterFallbackSpriteUrl: string | null;
  script: ScenarioScript;
  assetIndex: GameAssetIndex;
  isPremium: boolean;
  ownedItemSlugs: string[];
  giftItems: GiftItem[];
}

export function GamePlayerClient(props: Props) {
  const router = useRouter();
  const [endedNotice, setEndedNotice] = useState<string | null>(null);
  const [items, setItems] = useState<GiftItem[]>(props.giftItems);
  const useGift = useGameStore((s) => s.useGift);
  const snapshot = useGameStore((s) => s.snapshot);
  const state = useGameStore((s) => s.state);

  const handleSave = async () => {
    const snap = snapshot();
    if (!snap) return;
    try {
      await fetch('/api/game/save-slots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          characterId: props.characterId,
          slotIndex: 0,
          label: `第${(state?.stepIndex ?? 0) + 1}手`,
          snapshot: snap,
        }),
      });
      alert('セーブしました');
    } catch {
      alert('セーブに失敗しました');
    }
  };

  const handleGiveGift = async (item: GiftItem) => {
    try {
      const res = await fetch('/api/game/gift', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          characterId: props.characterId,
          itemId: item.id,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? 'プレゼントに失敗しました');
      }
      const data: { affinity: number; remaining: number; affinityBoost: number } = await res.json();
      // ストア側の親密度を上書き
      useGift(data.affinityBoost);
      // 所持数を更新
      setItems((prev) =>
        prev.map((g) => (g.id === item.id ? { ...g, owned: data.remaining } : g)),
      );
      alert(`${item.name} を贈った! 親密度 +${data.affinityBoost} (現在: ${data.affinity})`);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleBuyGift = async (item: GiftItem) => {
    try {
      const res = await fetch('/api/game/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'ITEM',
          itemId: item.id,
          quantity: 1,
          successUrl: window.location.href,
          cancelUrl: window.location.href,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '購入手続きに失敗しました');
      }
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleClose = () => {
    router.push(`/game/${props.characterSlug}`);
  };

  const handleScenarioEnded = async () => {
    // ストアから現在の状態を取得
    const s = useGameStore.getState().state;
    if (!s) return;
    setEndedNotice('章をクリアしました!');
    try {
      await fetch('/api/game/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          characterId: props.characterId,
          scenarioId: props.scenarioId,
          sceneKey: s.sceneKey,
          affinity: s.affinity,
          flags: s.flags as Record<string, boolean | number | string>,
          routeResult: s.routeResult,
        }),
      });
      // 章クリアマーキング
      await fetch('/api/game/save-slots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          characterId: props.characterId,
          slotIndex: 0,
          label: '章クリア',
          snapshot: {
            scenarioId: props.scenarioId,
            sceneKey: s.sceneKey,
            stepIndex: s.stepIndex,
            affinity: s.affinity,
            flags: s.flags,
          },
        }),
      });
    } catch {
      /* 失敗は無視 (UI は既にクリア表示) */
    }
  };

  return (
    <div className="relative">
      <GamePlayer
        script={props.script}
        scenarioId={props.scenarioId}
        characterName={props.characterName}
        characterFallbackSpriteUrl={props.characterFallbackSpriteUrl}
        assetIndex={props.assetIndex}
        isPremium={props.isPremium}
        ownedItemSlugs={props.ownedItemSlugs}
        giftItems={items}
        onSave={handleSave}
        onClose={handleClose}
        onGiveGift={handleGiveGift}
        onBuyGift={handleBuyGift}
        onScenarioEnded={handleScenarioEnded}
      />
      {endedNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
            <p className="text-2xl">🎉</p>
            <h2 className="mt-2 text-lg font-bold text-slate-900">{endedNotice}</h2>
            <p className="mt-1 text-sm text-slate-600">
              親密度: {state?.affinity ?? 0}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => router.push(`/game/${props.characterSlug}`)}
                className="flex-1 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                キャラページへ戻る
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
