'use client';

/**
 * ギャラリー画像の編集 UI (種別 = ギャラリー のときだけ表示)。
 *
 * ## なぜ必要だったか
 *
 * `ContentType.GALLERY` と `content_images` テーブルは以前から存在し、
 * 管理フォームでも種別「ギャラリー」を選べた。しかし
 *
 *   - 画像を登録する UI が無く、`imageUrls` を送る手段が実質無かった
 *   - 表示側 (詳細ページ) も `include: { images }` で取得はするが
 *     一切描画していなかった
 *
 * ため、ギャラリーは「選べるが何も起きない種別」だった。
 * ここはその欠けていた登録側を埋めるもの。
 *
 * ## 複数枚を一度に扱う
 *
 * ライブ写真は 1 回に数十枚まとめて上げるのが普通なので、
 *   - ファイル選択で複数枚同時アップロード
 *   - ドラッグ&ドロップ
 * の両方に対応する。1 枚ずつ選ばせると運営の手間が非現実的になる。
 *
 * アップロードは 1 枚ずつ順番に行う (並列にしない)。
 * 30 枚を同時に POST すると回線を占有し、
 * どれが失敗したのか分からなくなるため。
 * 進捗を「3 / 30 枚」と出して待ち時間の見通しを与える。
 *
 * ## 並び替え
 *
 * ギャラリーは「時系列に並べたい」ことが多いので順序が重要。
 * ドラッグによる並び替えはタッチ端末で扱いづらく実装も重いので、
 * 各画像に「←」「→」ボタンを置く方式にした。
 * 数十枚を大きく動かすのには向かないが、
 * アップロード順が基本的に正しいので微調整で足りる。
 */
import { useCallback, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Trash2, ImagePlus, Star } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { toast } from '@/stores/ui-store';
import { validateContentBodyImage } from '@/lib/content-body-image';
import { GALLERY_IMAGE_MAX } from '@/lib/gallery';

export type GalleryImageDraft = {
  url: string;
  caption: string;
};

export function GalleryImagesEditor({
  images,
  onChange,
  uploadUrl,
}: {
  images: GalleryImageDraft[];
  onChange: (next: GalleryImageDraft[]) => void;
  uploadUrl: string;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // ドラッグは子要素に入るたび leave が飛ぶので、深さを数えて枠の点滅を防ぐ
  const dragDepth = useRef(0);

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const room = GALLERY_IMAGE_MAX - images.length;
      if (room <= 0) {
        toast.error(`画像は 1 つのギャラリーに ${GALLERY_IMAGE_MAX} 枚までです`);
        return;
      }

      // 上限を超える分は先に切る。
      // 全部送ってから «入りませんでした» と言うのは待ち時間の無駄。
      const targets = files.slice(0, room);
      if (files.length > room) {
        toast.error(
          `${GALLERY_IMAGE_MAX} 枚を超えるため、${targets.length} 枚だけ追加します`,
        );
      }

      setBusy(true);
      setProgress({ done: 0, total: targets.length });

      const added: GalleryImageDraft[] = [];
      let failed = 0;

      try {
        // 逐次アップロード。並列にすると回線を占有し、
        // どれが失敗したか分からなくなる。
        for (let i = 0; i < targets.length; i += 1) {
          const file = targets[i]!;
          setProgress({ done: i, total: targets.length });

          const check = validateContentBodyImage({
            contentType: file.type,
            sizeBytes: file.size,
          });
          if (!check.ok) {
            failed += 1;
            continue;
          }

          try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch(uploadUrl, { method: 'POST', body: fd });
            const json = (await res.json().catch(() => ({}))) as { url?: string };
            if (!res.ok || !json.url) {
              failed += 1;
              continue;
            }
            // キャプションの初期値は空。ファイル名を入れると
            // 「DSC_0123」のような無意味な文字列が写真の下に並ぶ。
            added.push({ url: json.url, caption: '' });
          } catch {
            failed += 1;
          }
        }

        if (added.length > 0) onChange([...images, ...added]);

        if (added.length > 0 && failed === 0) {
          toast.success(`${added.length} 枚を追加しました`);
        } else if (added.length > 0) {
          toast.error(`${added.length} 枚を追加しました（${failed} 枚は失敗しました）`);
        } else {
          toast.error('画像を追加できませんでした。形式とサイズをご確認ください。');
        }
      } finally {
        setBusy(false);
        setProgress(null);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [images, onChange, uploadUrl],
  );

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    const a = next[index]!;
    const b = next[target]!;
    next[index] = b;
    next[target] = a;
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(images.filter((_, i) => i !== index));
  };

  const setCaption = (index: number, caption: string) => {
    onChange(images.map((img, i) => (i === index ? { ...img, caption } : img)));
  };

  const moveToFront = (index: number) => {
    if (index === 0) return;
    const next = [...images];
    const [picked] = next.splice(index, 1);
    if (picked) next.unshift(picked);
    onChange(next);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">ギャラリー写真</h2>
          <span className="text-xs text-slate-500">
            {images.length} / {GALLERY_IMAGE_MAX} 枚
          </span>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-slate-500">
          ライブ写真などをまとめて追加できます。並び順がそのまま表示順になります。
          <br />
          1 枚目が一覧のサムネイルになります（カバー画像を設定した場合はそちらが優先）。
        </p>

        {/* ===== 追加エリア (クリック / ドラッグ&ドロップ) ===== */}
        <div
          onDragEnter={(e) => {
            if (!Array.from(e.dataTransfer.types).includes('Files')) return;
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            const files = Array.from(e.dataTransfer.files).filter((f) =>
              f.type.startsWith('image/'),
            );
            if (files.length > 0) void upload(files);
          }}
          className={`rounded-md border-2 border-dashed px-4 py-6 text-center transition ${
            dragging ? 'border-brand-400 bg-brand-50' : 'border-slate-300 bg-slate-50'
          }`}
        >
          <ImagePlus className="mx-auto mb-2 h-6 w-6 text-slate-400" aria-hidden />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? 'アップロード中…' : '写真を選ぶ（複数可）'}
          </button>
          <p className="mt-2 text-xs text-slate-500">
            ここにドラッグ&amp;ドロップでも追加できます
          </p>
          {progress && (
            <p className="mt-2 text-xs font-semibold text-brand-700" aria-live="polite">
              {progress.done} / {progress.total} 枚をアップロード中…
            </p>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) void upload(files);
            }}
          />
        </div>

        {/* ===== 登録済みの写真 ===== */}
        {images.length === 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            写真がまだありません。ギャラリーとして公開するには 1 枚以上追加してください。
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {images.map((img, i) => (
              <li
                key={`${img.url}-${i}`}
                className="overflow-hidden rounded-md border border-slate-200 bg-white"
              >
                <div className="relative aspect-video w-full bg-slate-100">
                  {/* next/image を使わないのは、URL が外部 / S3 / 内部配信パスの
                      3 形態を取り、images.remotePatterns の追加漏れで
                      500 になる事故が既にあったため。 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.caption || `写真 ${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {i + 1}
                    {i === 0 && ' (サムネイル)'}
                  </span>
                </div>
                <div className="space-y-2 p-2">
                  <input
                    type="text"
                    value={img.caption}
                    onChange={(e) => setCaption(i, e.target.value)}
                    placeholder="キャプション (任意)"
                    maxLength={200}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
                  />
                  <div className="flex items-center gap-1">
                    <IconBtn
                      label="前へ"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      icon={<ArrowLeft className="h-3.5 w-3.5" aria-hidden />}
                    />
                    <IconBtn
                      label="後へ"
                      disabled={i === images.length - 1}
                      onClick={() => move(i, 1)}
                      icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden />}
                    />
                    <IconBtn
                      label="先頭にする"
                      disabled={i === 0}
                      onClick={() => moveToFront(i)}
                      icon={<Star className="h-3.5 w-3.5" aria-hidden />}
                    />
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      削除
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function IconBtn({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {icon}
    </button>
  );
}
