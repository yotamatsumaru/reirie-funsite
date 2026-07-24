'use client';

/**
 * サイト画像 (トップページのヒーロー画像等) のアップロード UI (SUPER_ADMIN)。
 *
 * スロットごとに画像ファイルをアップロード / 差し替え / 削除できる。
 * 保存は /api/super-admin/site-images (multipart) 経由。コード編集・デプロイ不要。
 */
import { useRef, useState } from 'react';
import {
  SITE_IMAGE_SLOTS,
  SITE_IMAGE_SLOT_META,
  type SiteImageSlot,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { toast } from '@/stores/ui-store';

export type SiteImageItem = {
  slot: SiteImageSlot;
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

export function SiteImageClient({ initial }: { initial: SiteImageItem[] }) {
  // slot → item のマップ (可変)
  const initialMap: Partial<Record<SiteImageSlot, SiteImageItem>> = {};
  for (const it of initial) initialMap[it.slot] = it;

  const [items, setItems] =
    useState<Partial<Record<SiteImageSlot, SiteImageItem>>>(initialMap);
  const [busySlot, setBusySlot] = useState<SiteImageSlot | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(slot: SiteImageSlot, file: File) {
    setBusySlot(slot);
    try {
      const form = new FormData();
      form.append('slot', slot);
      form.append('file', file);
      const res = await fetch('/api/super-admin/site-images', {
        method: 'POST',
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'アップロードに失敗しました');
      }
      const item = json.item as SiteImageItem;
      setItems((m) => ({ ...m, [slot]: item }));
      toast.success(`「${SITE_IMAGE_SLOT_META[slot].label}」を更新しました`);
    } catch (e) {
      toast.error((e as Error).message, 'アップロードエラー');
    } finally {
      setBusySlot(null);
      const el = inputRefs.current[slot];
      if (el) el.value = '';
    }
  }

  async function remove(slot: SiteImageSlot) {
    if (!window.confirm(`「${SITE_IMAGE_SLOT_META[slot].label}」を削除しますか？（デフォルト画像に戻ります）`)) {
      return;
    }
    setBusySlot(slot);
    try {
      const res = await fetch(`/api/super-admin/site-images?slot=${encodeURIComponent(slot)}`, {
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
      toast.success('画像を削除しました');
    } catch (e) {
      toast.error((e as Error).message, '削除エラー');
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-800">サイト画像</h2>
        <p className="mt-1 text-xs text-slate-500">
          トップページ等に表示される画像を差し替えます。
          対応形式: JPEG / PNG / WebP / GIF / AVIF・8MB 以内。
          未設定の場合はデフォルトの画像が表示されます。
        </p>
      </CardHeader>
      <CardBody>
        <div className="space-y-3">
          {SITE_IMAGE_SLOTS.map((slot) => {
            const meta = SITE_IMAGE_SLOT_META[slot];
            const item = items[slot];
            const busy = busySlot === slot;
            return (
              <div
                key={slot}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  {/* プレビュー (横長スロットは横長枠、それ以外は縦長枠で表示) */}
                  <div
                    className={`shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white ${
                      slot.includes('desktop') || slot.includes('thumbnail')
                        ? 'h-16 w-28'
                        : 'h-20 w-16'
                    }`}
                  >
                    {item ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.url}
                        alt={meta.label}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
                        未設定
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-800">{meta.label}</p>
                      {item ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          設定済み
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                          デフォルト画像
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {meta.description}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {meta.recommendedAspect}
                    </p>
                    {item ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {item.fileName ?? 'image'}・{fmtSize(item.sizeBytes)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
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
                    className="max-w-[190px] text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-twilight-rose file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:opacity-90 disabled:opacity-50"
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
          ※ アップロード後はサイトに即時反映されます (再デプロイ不要)。
        </p>
      </CardBody>
    </Card>
  );
}
