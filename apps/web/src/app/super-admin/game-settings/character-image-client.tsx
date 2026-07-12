'use client';

/**
 * あっち向いてホイ キャラクター画像のアップロード UI (SUPER_ADMIN)。
 *
 * ポーズ (idle/rock/scissors/paper/up/down/left/right) ごとに、
 * 最大 CHARACTER_IMAGE_VARIANTS_PER_SLOT (=3) パターンの画像を
 * アップロード / 差し替え / 削除できる。
 * ゲーム画面では、そのポーズに登録されているパターンからランダムに 1 枚が表示される。
 * デモの人形 (SVG プレースホルダー) を任意の画像に置き換えられるようにするための機能。
 * 保存は /api/super-admin/character-images (multipart) 経由。コード編集・デプロイ不要。
 * 1 パターンも未設定のポーズは自動で SVG プレースホルダーが表示される。
 */
import { useRef, useState } from 'react';
import {
  CHARACTER_IMAGE_SLOTS,
  CHARACTER_IMAGE_SLOT_META,
  CHARACTER_IMAGE_VARIANTS,
  type CharacterImageSlot,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { toast } from '@/stores/ui-store';

export type CharacterImageItem = {
  slot: CharacterImageSlot;
  variant: number;
  url: string;
  fileName: string | null;
  sizeBytes: number | null;
  updatedAt: string;
};

/** slot と variant を合成したキー (state 管理・busy 判定用)。 */
function keyOf(slot: CharacterImageSlot, variant: number): string {
  return `${slot}:${variant}`;
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function CharacterImageClient({ initial }: { initial: CharacterImageItem[] }) {
  // "slot:variant" → item のマップ (可変)
  const initialMap: Record<string, CharacterImageItem> = {};
  for (const it of initial) initialMap[keyOf(it.slot, it.variant)] = it;

  const [items, setItems] = useState<Record<string, CharacterImageItem>>(initialMap);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(slot: CharacterImageSlot, variant: number, file: File) {
    const k = keyOf(slot, variant);
    setBusyKey(k);
    try {
      const form = new FormData();
      form.append('slot', slot);
      form.append('variant', String(variant));
      form.append('file', file);
      const res = await fetch('/api/super-admin/character-images', {
        method: 'POST',
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'アップロードに失敗しました');
      }
      const item = json.item as CharacterImageItem;
      setItems((m) => ({ ...m, [k]: item }));
      toast.success(
        `「${CHARACTER_IMAGE_SLOT_META[slot].label}」パターン${variant} の画像を保存しました`,
      );
    } catch (e) {
      toast.error((e as Error).message, 'アップロードエラー');
    } finally {
      setBusyKey(null);
      const el = inputRefs.current[k];
      if (el) el.value = '';
    }
  }

  async function remove(slot: CharacterImageSlot, variant: number) {
    const label = CHARACTER_IMAGE_SLOT_META[slot].label;
    if (!window.confirm(`「${label}」パターン${variant} の画像を削除しますか？`)) {
      return;
    }
    const k = keyOf(slot, variant);
    setBusyKey(k);
    try {
      const res = await fetch(
        `/api/super-admin/character-images?slot=${encodeURIComponent(slot)}&variant=${variant}`,
        { method: 'DELETE' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '削除に失敗しました');
      }
      setItems((m) => {
        const next = { ...m };
        delete next[k];
        return next;
      });
      toast.success('画像を削除しました');
    } catch (e) {
      toast.error((e as Error).message, '削除エラー');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-800">
          あっち向いてホイ キャラクター画像
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          ゲーム画面に表示するキャラクター画像 (現在は人形の SVG) を、ポーズごとに
          最大 {CHARACTER_IMAGE_VARIANTS.length} パターンまで登録できます。
          ゲームでは、そのポーズに登録されているパターンから
          <span className="font-semibold text-slate-600">ランダムに 1 枚</span>
          が表示されます。対応形式: JPEG / PNG / WebP / GIF / AVIF・8MB 以内。
          1 パターンも未設定のポーズは自動で SVG プレースホルダーが表示されます。
        </p>
      </CardHeader>
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2">
          {CHARACTER_IMAGE_SLOTS.map((slot) => {
            const meta = CHARACTER_IMAGE_SLOT_META[slot];
            const setCount = CHARACTER_IMAGE_VARIANTS.filter(
              (v) => items[keyOf(slot, v)],
            ).length;
            return (
              <div
                key={slot}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-800">{meta.label}</p>
                    {setCount > 0 ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        {setCount}/{CHARACTER_IMAGE_VARIANTS.length} 設定済み
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        未設定(SVG)
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-500">{meta.description}</p>

                {/* パターン 1〜3 の枠 */}
                <div className="grid grid-cols-3 gap-2">
                  {CHARACTER_IMAGE_VARIANTS.map((variant) => {
                    const k = keyOf(slot, variant);
                    const item = items[k];
                    const busy = busyKey === k;
                    return (
                      <div
                        key={variant}
                        className="flex flex-col gap-1.5 rounded-md border border-slate-200 bg-white p-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-500">
                            パターン{variant}
                          </span>
                          {busy ? (
                            <span className="text-[10px] text-slate-400">処理中…</span>
                          ) : null}
                        </div>
                        <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded border border-slate-100 bg-slate-50">
                          {item ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.url}
                              alt={`${meta.label} パターン${variant}`}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <span className="text-[10px] text-slate-400">SVG</span>
                          )}
                        </div>
                        {item ? (
                          <p className="truncate text-[10px] text-slate-400" title={item.fileName ?? undefined}>
                            {fmtSize(item.sizeBytes)}
                          </p>
                        ) : (
                          <p className="text-[10px] text-slate-300">未登録</p>
                        )}
                        <input
                          ref={(el) => {
                            inputRefs.current[k] = el;
                          }}
                          type="file"
                          accept="image/*"
                          disabled={busy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void upload(slot, variant, f);
                          }}
                          className="w-full text-[10px] text-slate-600 file:mr-1 file:rounded file:border-0 file:bg-twilight-amethyst file:px-1.5 file:py-1 file:text-[10px] file:font-semibold file:text-white hover:file:opacity-90 disabled:opacity-50"
                        />
                        {item ? (
                          <button
                            type="button"
                            onClick={() => void remove(slot, variant)}
                            disabled={busy}
                            className="rounded border border-rose-300 px-1.5 py-1 text-[10px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          >
                            削除
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-slate-400">
          ※ アップロード後は会員のゲーム画面に即時反映されます (再デプロイ不要)。
          同じポーズに複数パターンを登録すると、ゲーム表示のたびにランダムで
          1 枚が選ばれます。「上/下/左/右」はあっち向いてホイの方向対決ラウンドで、
          キャラクターがその方向を向いたときに表示される画像です。
        </p>
      </CardBody>
    </Card>
  );
}
