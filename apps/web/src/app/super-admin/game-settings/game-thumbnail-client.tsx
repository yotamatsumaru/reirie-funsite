'use client';

/**
 * ミニゲームのサムネイル画像アップロード UI (SUPER_ADMIN)。
 *
 * ゲーム一覧 (/game) のミニゲームカードに表示するサムネイル画像を、
 * ゲームごとに 1 枚アップロード / 差し替え / 削除できる。
 * 保存は SiteImage インフラ (/api/super-admin/site-images) を再利用する
 * (slot = `game.<slug>.thumbnail`)。コード編集・デプロイ不要。
 * 未設定のゲームはカードに絵文字プレースホルダーが表示される。
 */
import { useRef, useState } from 'react';
import { SITE_IMAGE_SLOT_META, type SiteImageSlot } from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { toast } from '@/stores/ui-store';

export type GameThumbnailItem = {
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

export function GameThumbnailClient({
  slot,
  initial,
}: {
  slot: SiteImageSlot;
  initial: GameThumbnailItem | null;
}) {
  const [item, setItem] = useState<GameThumbnailItem | null>(initial);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const meta = SITE_IMAGE_SLOT_META[slot];

  async function upload(file: File) {
    setBusy(true);
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
      setItem(json.item as GameThumbnailItem);
      toast.success('サムネイル画像を保存しました');
    } catch (e) {
      toast.error((e as Error).message, 'アップロードエラー');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    if (!window.confirm('サムネイル画像を削除しますか？')) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/super-admin/site-images?slot=${encodeURIComponent(slot)}`,
        { method: 'DELETE' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '削除に失敗しました');
      }
      setItem(null);
      toast.success('サムネイル画像を削除しました');
    } catch (e) {
      toast.error((e as Error).message, '削除エラー');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-800">ゲームサムネイル</h2>
        <p className="mt-1 text-xs text-slate-500">
          {meta.description} 対応形式: JPEG / PNG / WebP / GIF / AVIF・8MB 以内。
          {meta.recommendedAspect ? `（${meta.recommendedAspect}）` : ''}
        </p>
      </CardHeader>
      <CardBody>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex aspect-[16/9] w-full max-w-xs items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {item ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.url} alt="サムネイル" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-slate-400">未設定 (絵文字表示)</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {item ? (
              <>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  設定済み
                </span>
                <p className="text-xs text-slate-400">{fmtSize(item.sizeBytes)}</p>
              </>
            ) : (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                未設定
              </span>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
              className="text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-twilight-amethyst file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:opacity-90 disabled:opacity-50"
            />
            {item ? (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="w-fit rounded border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
              >
                削除
              </button>
            ) : null}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
