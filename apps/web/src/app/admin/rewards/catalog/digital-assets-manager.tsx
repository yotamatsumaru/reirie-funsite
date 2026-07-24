/**
 * デジタル特典 (DIGITAL) の配布ファイル管理 UI (Client Component)。
 *  - 画像 (PNG/JPEG/WebP) を複数アップロード
 *  - 一覧表示 / 削除
 *
 * 景品編集画面 (kind === 'DIGITAL') でのみ表示する。
 */
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MAX_REWARD_DIGITAL_ASSET_BYTES,
  MAX_REWARD_DIGITAL_ASSETS_PER_ITEM,
} from '@idol/shared';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';

type Asset = {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  sortOrder: number;
  createdAt: string;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DigitalAssetsManager({
  catalogItemId,
  initialAssets,
}: {
  catalogItemId: string;
  initialAssets: Asset[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const full = assets.length >= MAX_REWARD_DIGITAL_ASSETS_PER_ITEM;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const list = Array.from(files);
      let done = 0;
      for (const file of list) {
        if (assets.length + done >= MAX_REWARD_DIGITAL_ASSETS_PER_ITEM) {
          setError(`ファイルは最大 ${MAX_REWARD_DIGITAL_ASSETS_PER_ITEM} 件までです`);
          break;
        }
        if (file.size > MAX_REWARD_DIGITAL_ASSET_BYTES) {
          setError(`${file.name} は 20MB を超えています`);
          continue;
        }
        setProgress(`アップロード中… (${done + 1}/${list.length}) ${file.name}`);
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`/api/admin/reward-catalog/${catalogItemId}/assets`, {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error?.message ?? `${file.name} のアップロードに失敗しました`);
        }
        const data = (await res.json()) as { asset: Asset };
        setAssets((prev) => [...prev, data.asset]);
        done += 1;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    }
  }

  async function handleDelete(assetId: string) {
    if (!confirm('このファイルを削除しますか？（交換済みの会員はダウンロードできなくなります）')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/reward-catalog/${catalogItemId}/assets/${assetId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('削除に失敗しました');
      setAssets((prev) => prev.filter((a) => a.id !== assetId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">デジタル特典ファイル（壁紙など）</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            交換した会員がダウンロードできる画像ファイルです（PNG / JPEG / WebP・1 ファイル 20MB
            まで・最大 {MAX_REWARD_DIGITAL_ASSETS_PER_ITEM} 件）。スマホ用・PC 用などを複数登録できます。
          </p>
        </div>

        {assets.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
            まだファイルがありません。下のボタンから画像を追加してください。
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {assets.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{a.fileName}</p>
                  <p className="text-[11px] text-slate-400">
                    {a.contentType} · {formatSize(a.fileSize)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(a.id)}
                  disabled={busy}
                  className="shrink-0 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        )}
        {progress && <p className="text-xs text-slate-500">{progress}</p>}

        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            loading={busy}
            disabled={full}
            onClick={() => inputRef.current?.click()}
          >
            {full ? 'ファイル数が上限に達しています' : '画像を追加（複数可）'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
