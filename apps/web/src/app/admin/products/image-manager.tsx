'use client';

/**
 * 商品詳細ページの「商品画像（複数）」管理。
 *  - 複数ファイルを選択してアップロード（/api/admin/uploads/image → /api/admin/products/[id]/images）
 *  - 一覧表示・削除・並べ替え（先頭がメイン画像）
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export type ProductImageItem = {
  id: string;
  url: string;
  alt: string | null;
  sortOrder: number;
};

export function ImageManager({
  productId,
  images,
}: {
  productId: string;
  images: ProductImageItem[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function uploadOne(file: File): Promise<void> {
    // アップロードと画像レコード作成を 1 リクエストに統合 (multipart)。
    // 保存先 (S3 or DB) はサーバー側で環境に応じて自動選択される。
    const fd = new FormData();
    fd.append('file', file);
    fd.append('alt', file.name.replace(/\.[^.]+$/, ''));
    const res = await fetch(`/api/admin/products/${productId}/images`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(j.error?.message ?? `アップロード失敗 (HTTP ${res.status})`);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    const list = Array.from(files);
    try {
      for (let i = 0; i < list.length; i++) {
        setProgress(`アップロード中… (${i + 1}/${list.length})`);
        await uploadOne(list[i]);
      }
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '不明なエラーが発生しました');
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  function reorder(newOrder: string[]) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/products/${productId}/images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: newOrder }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(j.error?.message ?? `並べ替えに失敗 (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    });
  }

  function move(index: number, dir: -1 | 1) {
    const ids = images.map((i) => i.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder(ids);
  }

  function makeMain(index: number) {
    if (index === 0) return;
    const ids = images.map((i) => i.id);
    const [picked] = ids.splice(index, 1);
    ids.unshift(picked);
    reorder(ids);
  }

  function remove(imageId: string) {
    if (!confirm('この画像を削除しますか？')) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/products/${productId}/images/${imageId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(j.error?.message ?? `削除に失敗 (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    });
  }

  const busy = pending || uploading;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            商品画像（{images.length} 枚）
          </h2>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={uploading}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              + 画像を追加（複数可）
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-slate-500">
          先頭の画像がショップ一覧などで使われるメイン画像です。JPEG/PNG/WebP/GIF/AVIF・1枚 8MB まで。
        </p>

        {progress && <p className="text-xs text-brand-600">{progress}</p>}

        {images.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            まだ画像がありません。「画像を追加」から複数枚アップロードできます。
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {images.map((img, idx) => (
              <div
                key={img.id}
                className="overflow-hidden rounded-md border border-slate-200 bg-white"
              >
                <div className="relative aspect-square bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.alt ?? ''}
                    className="h-full w-full object-cover"
                  />
                  {idx === 0 && (
                    <span className="absolute left-1.5 top-1.5">
                      <Badge tone="brand">メイン</Badge>
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-1 p-2">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      title="左へ"
                      disabled={busy || idx === 0}
                      onClick={() => move(idx, -1)}
                      className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      title="右へ"
                      disabled={busy || idx === images.length - 1}
                      onClick={() => move(idx, 1)}
                      className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      →
                    </button>
                    {idx !== 0 && (
                      <button
                        type="button"
                        title="メインにする"
                        disabled={busy}
                        onClick={() => makeMain(idx)}
                        className="rounded border border-brand-300 px-1.5 py-0.5 text-xs text-brand-600 hover:bg-brand-50 disabled:opacity-40"
                      >
                        ★
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(img.id)}
                    className="rounded border border-rose-200 px-1.5 py-0.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
