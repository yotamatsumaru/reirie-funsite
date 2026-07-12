'use client';

/**
 * あっち向いてホイ キャラボイスのアップロード UI (SUPER_ADMIN)。
 *
 * スロットごとに音声ファイルをアップロード / 差し替え / 削除できる。
 * 保存は /api/super-admin/game-audio (multipart) 経由。コード編集・デプロイ不要。
 */
import { useRef, useState } from 'react';
import {
  ACCHI_VOICE_SLOTS,
  ACCHI_VOICE_SLOT_META,
  type AcchiVoiceSlot,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { toast } from '@/stores/ui-store';

export type GameAudioItem = {
  slot: AcchiVoiceSlot;
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

export function GameAudioClient({ initial }: { initial: GameAudioItem[] }) {
  // slot → item のマップ (可変)
  const initialMap: Partial<Record<AcchiVoiceSlot, GameAudioItem>> = {};
  for (const it of initial) initialMap[it.slot] = it;

  const [items, setItems] =
    useState<Partial<Record<AcchiVoiceSlot, GameAudioItem>>>(initialMap);
  const [busySlot, setBusySlot] = useState<AcchiVoiceSlot | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(slot: AcchiVoiceSlot, file: File) {
    setBusySlot(slot);
    try {
      const form = new FormData();
      form.append('slot', slot);
      form.append('file', file);
      const res = await fetch('/api/super-admin/game-audio', {
        method: 'POST',
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'アップロードに失敗しました');
      }
      const item = json.item as GameAudioItem;
      setItems((m) => ({ ...m, [slot]: item }));
      toast.success(`「${ACCHI_VOICE_SLOT_META[slot].label}」のボイスを保存しました`);
    } catch (e) {
      toast.error((e as Error).message, 'アップロードエラー');
    } finally {
      setBusySlot(null);
      const el = inputRefs.current[slot];
      if (el) el.value = '';
    }
  }

  async function remove(slot: AcchiVoiceSlot) {
    if (!window.confirm(`「${ACCHI_VOICE_SLOT_META[slot].label}」のボイスを削除しますか？`)) {
      return;
    }
    setBusySlot(slot);
    try {
      const res = await fetch(`/api/super-admin/game-audio?slot=${encodeURIComponent(slot)}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '削除に失敗しました');
      }
      setItems((m) => {
        const next = { ...m };
        delete next[slot];
        return next;
      });
      toast.success('ボイスを削除しました');
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
          あっち向いてホイ キャラボイス
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          各シーンで再生するキャラクターボイス (REIRIE) をアップロードします。
          対応形式: mp3 / wav / ogg / m4a / aac / webm・5MB 以内・各 1〜2 秒程度。
          未設定のシーンは効果音のみで再生されます。
        </p>
      </CardHeader>
      <CardBody>
        <div className="space-y-3">
          {ACCHI_VOICE_SLOTS.map((slot) => {
            const meta = ACCHI_VOICE_SLOT_META[slot];
            const item = items[slot];
            const busy = busySlot === slot;
            return (
              <div
                key={slot}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-800">{meta.label}</p>
                    {item ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        設定済み
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        未設定
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {meta.timing}・例: 「{meta.scriptExample}」
                  </p>
                  {item ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {/* プレビュー再生 */}
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <audio controls preload="none" src={item.url} className="h-8" />
                      <span>
                        {item.fileName ?? 'audio'}・{fmtSize(item.sizeBytes)}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <input
                    ref={(el) => {
                      inputRefs.current[slot] = el;
                    }}
                    type="file"
                    accept="audio/*"
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
                  {busy ? <span className="text-xs text-slate-400">処理中…</span> : null}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-slate-400">
          ※ アップロード後は会員のゲーム画面に即時反映されます (再デプロイ不要)。
          効果音 (ボタン・勝敗音) はアプリ同梱の固定音源です。
        </p>
      </CardBody>
    </Card>
  );
}
