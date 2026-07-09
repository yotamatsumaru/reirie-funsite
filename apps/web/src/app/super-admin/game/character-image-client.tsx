'use client';

/**
 * あっち向いてホイ キャラクター画像のアップロード UI (SUPER_ADMIN)。
 *
 * ポーズ (idle/rock/scissors/paper/up/down/left/right) ごとに画像ファイルを
 * アップロード / 差し替え / 削除できる。デモの人形 (SVG プレースホルダー) を
 * 任意の画像に置き換えられるようにするための機能。
 * 保存は /api/super-admin/character-images (multipart) 経由。コード編集・デプロイ不要。
 * 未設定のポーズは自動で SVG プレースホルダーが表示される。
 */
import { useRef, useState } from 'react';
import {
  CHARACTER_IMAGE_SLOTS,
  CHARACTER_IMAGE_SLOT_META,
  type CharacterImageSlot,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { toast } from '@/stores/ui-store';

export type CharacterImageItem = {
  slot: CharacterImageSlot;
  url: string;
  fileName: string | null;
  sizeBytes: number | null;
  updatedAt: string;
};

function fmtSize(bytes: number | null): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function CharacterImageClient({ initial }: { initial: CharacterImageItem[] }) {
  // slot → item のマップ (可変)
  const initialMap: Partial<Record<CharacterImageSlot, CharacterImageItem>> = {};
  for (const it of initial) initialMap[it.slot] = it;

  const [items, setItems] =
    useState<Partial<Record<CharacterImageSlot, CharacterImageItem>>>(initialMap);
  const [busySlot, setBusySlot] = useState<CharacterImageSlot | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(slot: CharacterImageSlot, file: File) {
    setBusySlot(slot);
    try {
      const form = new FormData();
      form.append('slot', slot);
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
      setItems((m) => ({ ...m, [slot]: item }));
      toast.success(`「${CHARACTER_IMAGE_SLOT_META[slot].label}」の画像を保存しました`);
    } catch (e) {
      toast.error((e as Error).message, 'アップロードエラー');
    } finally {
      setBusySlot(null);
      const el = inputRefs.current[slot];
      if (el) el.value = '';
    }
  }

  async function remove(slot: CharacterImageSlot) {
    if (!window.confirm(`「${CHARACTER_IMAGE_SLOT_META[slot].label}」の画像を削除しますか？`)) {
      return;
    }
    setBusySlot(slot);
    try {
      const res = await fetch(
        `/api/super-admin/character-images?slot=${encodeURIComponent(slot)}`,
        { method: 'DELETE' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '削除に失敗しました');
      }
      setItems((m) => {
        const next = { ...m };
        delete next[slot];
        return next;
      });
      toast.success('画像を削除しました (SVGプレースホルダーに戻ります)');
    } catch (e) {
      toast.error((e as Error).message, '削除エラー');
    } finally {
      setBusySlot(null);
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
          任意の画像へ差し替えられます。対応形式: JPEG / PNG / WebP / GIF / AVIF・8MB 以内。
          未設定のポーズは自動で SVG プレースホルダーが表示されます。
        </p>
      </CardHeader>
      <CardBody>
        <div className="grid gap-3 sm:grid-cols-2">
          {CHARACTER_IMAGE_SLOTS.map((slot) => {
            const meta = CHARACTER_IMAGE_SLOT_META[slot];
            const item = items[slot];
            const busy = busySlot === slot;
            return (
              <div
                key={slot}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-800">{meta.label}</p>
                    {item ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        設定済み
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        未設定(SVG)
                      </span>
                    )}
                  </div>
                  {busy ? <span className="text-xs text-slate-400">処理中…</span> : null}
                </div>
                <p className="text-xs text-slate-500">{meta.description}</p>

                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white">
                    {item ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.url}
                        alt={meta.label}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-slate-400">SVG</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-xs text-slate-500">
                    {item ? (
                      <p className="truncate">
                        {item.fileName ?? 'image'}・{fmtSize(item.sizeBytes)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    ref={(el) => {
                      inputRefs.current[slot] = el;
                    }}
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(slot, f);
                    }}
                    className="max-w-[190px] text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-twilight-amethyst file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:opacity-90 disabled:opacity-50"
                  />
                  {item ? (
                    <button
                      type="button"
                      onClick={() => void remove(slot)}
                      disabled={busy}
                      className="rounded-md border border-rose-300 px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      削除
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-slate-400">
          ※ アップロード後は会員のゲーム画面に即時反映されます (再デプロイ不要)。
          「上/下/左/右」はあっち向いてホイの方向対決ラウンドで、キャラクターがその方向を
          向いたときに表示される画像です。
        </p>
      </CardBody>
    </Card>
  );
}
