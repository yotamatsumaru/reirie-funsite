'use client';

/**
 * ギャラリー詳細の写真グリッド + ライトボックス (拡大表示)。
 *
 * ## ライトボックスを自前で書く理由
 *
 * 既存の依存に画像ビューアが無く、この用途 (数十枚の写真を順に見る) の
 * ためだけにライブラリを足すとバンドルが増える。
 * 必要なのは「拡大 / 次へ / 前へ / 閉じる」だけなので自前で足りる。
 *
 * ## 操作方法を複数用意する理由
 *
 * ライブ写真は「スマホで指で送る」「PC で矢印キー」の両方が想定される。
 * どちらか一方だけだと片方の環境で著しく使いにくいので、
 *
 *   - クリック / タップ          … 拡大、次へ・前へボタン
 *   - キーボード                  … ← → で移動、Esc で閉じる
 *   - スワイプ                    … 左右フリックで移動
 *
 * を用意する。
 *
 * ## アクセシビリティ上の配慮
 *
 * - 開いている間は背景をスクロールさせない (body の overflow を切る)
 * - role="dialog" + aria-modal で支援技術に «別レイヤー» と伝える
 * - 閉じたときフォーカスを元のサムネイルに戻す
 *   (これが無いとキーボード操作でページ先頭に飛ばされる)
 *
 * ## 写真の持ち出し対策について（重要・限界を含む）
 *
 * 「できる限りコピーされないようにしたい」というご要望に対して、
 * ここでは **手軽な保存操作を防ぐ** 対策を入れている:
 *
 *   - 右クリック / 長押しメニューの抑制 (onContextMenu)
 *   - ドラッグでの画像抜き出しの禁止 (draggable={false} / onDragStart)
 *   - 長押ししたときの iOS の「画像を保存」シートの抑制
 *     (-webkit-touch-callout: none)
 *   - テキスト/画像の選択無効化 (select-none)
 *
 * ### できないことをはっきり書いておく
 *
 * これらはいずれも **完全な防止にはならない**。
 * ブラウザが表示している画像は必ず端末に届いているため、
 *
 *   - スクリーンショット / 画面収録
 *   - 開発者ツールや 「フレームを保存」
 *   - 画像 URL を直接開く
 *
 * は防げない。JavaScript を切られればこの対策自体が無効になる。
 * したがってこれは「悪意のある転載を止める仕組み」ではなく、
 * 「なんとなく保存してしまう」を減らし、
 * 合わせて «保存・転載は禁止» という意思表示を会員に伝えるものである。
 *
 * 実質的な保護はサーバー側の公開範囲チェック
 * (lib/media-access.ts と画像配信エンドポイント) が担っている。
 * 限定公開の写真はプランを満たさない限り URL を知っていても取得できない。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ShieldAlert, X, ZoomIn } from 'lucide-react';
import { formatImageCounter, stepIndex } from '@/lib/gallery';

export type GalleryPhoto = {
  url: string;
  caption: string | null;
};

export function GalleryGrid({ photos, title }: { photos: GalleryPhoto[]; title: string }) {
  /** 拡大中の添字。null は閉じている状態。 */
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // 閉じたときフォーカスを戻す先 (開くきっかけになったサムネイル)
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const touchStartX = useRef<number | null>(null);

  const close = useCallback(() => {
    setOpenIndex((prev) => {
      if (prev !== null) {
        // レンダー後にフォーカスを戻す。
        // 同期的に呼ぶと、まだ閉じていないので当たらない。
        const el = triggerRefs.current[prev];
        if (el) setTimeout(() => el.focus(), 0);
      }
      return null;
    });
  }, []);

  const step = useCallback(
    (delta: number) => {
      setOpenIndex((prev) => (prev === null ? prev : stepIndex(prev, delta, photos.length)));
    },
    [photos.length],
  );

  // キーボード操作。開いている間だけ購読する
  // (常時購読すると、ページ内の他の ← → 操作を奪ってしまう)。
  useEffect(() => {
    if (openIndex === null) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIndex, close, step]);

  // 拡大中は背景をスクロールさせない
  useEffect(() => {
    if (openIndex === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [openIndex]);

  if (photos.length === 0) return null;

  const current = openIndex !== null ? photos[openIndex] : null;

  return (
    <>
      {/*
        写真の扱いについての注意書き。
        技術的な対策だけでは防げないため、
        「保存・転載はご遠慮ください」という意思表示を明示する。
      */}
      <p className="mt-6 flex items-start gap-1.5 text-xs text-slate-400">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
        <span>
          写真の保存・転載・SNS への再アップロードはご遠慮ください。
        </span>
      </p>
      {/*
        グリッドは正方形タイル。写真の縦横比がまちまち (縦写真・横写真が混在)
        でも隙間なく並ぶため。元の比率は拡大時に見せる。
      */}
      <ul
        className="mt-3 grid select-none grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3"
        // 長押しで出る iOS の「画像を保存」シートを抑える。
        // Tailwind に相当クラスが無いので直接指定する。
        style={{ WebkitTouchCallout: 'none' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {photos.map((photo, i) => (
          <li key={`${photo.url}-${i}`}>
            <button
              ref={(el) => {
                triggerRefs.current[i] = el;
              }}
              type="button"
              onClick={() => setOpenIndex(i)}
              aria-label={`${photo.caption || `写真 ${i + 1}`}を拡大表示`}
              className="group relative block aspect-square w-full overflow-hidden rounded-lg bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {/* next/image を使わないのは、URL が外部 / S3 / 内部配信パスの
                  3 形態を取り、images.remotePatterns の追加漏れで
                  500 になる事故が既にあったため。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={photo.caption || `${title} の写真 ${i + 1}`}
                // 一覧に数十枚並ぶので遅延読み込みにする。
                // 全部即座に読むとモバイル回線で表示が止まる。
                loading="lazy"
                decoding="async"
                // ドラッグでデスクトップや他タブへ抜き出すのを防ぐ。
                // 属性と onDragStart の両方を入れているのは、
                // draggable="false" を無視するブラウザがあるため。
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                className="pointer-events-none h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              {/* ホバー時に «拡大できる» ことを示す */}
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/25">
                <ZoomIn className="h-6 w-6 text-white opacity-0 transition group-hover:opacity-100" aria-hidden />
              </span>
              {photo.caption && (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-left text-[11px] font-medium text-white">
                  {photo.caption}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {/* ===== ライトボックス ===== */}
      {current && openIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} の写真`}
          className="fixed inset-0 z-50 flex flex-col bg-black/90"
          // 背景 (写真以外) のクリックで閉じる。
          // 写真自体は stopPropagation して閉じないようにする
          // (拡大した写真を触ろうとして閉じてしまうのを防ぐ)。
          onClick={close}
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const start = touchStartX.current;
            touchStartX.current = null;
            if (start === null) return;
            const end = e.changedTouches[0]?.clientX ?? start;
            const dx = end - start;
            // 40px 未満はタップの揺れとみなす
            // (小さすぎると «閉じたいのに送られる» 誤操作になる)。
            if (Math.abs(dx) < 40) return;
            step(dx < 0 ? 1 : -1);
          }}
        >
          {/* 上部バー: 枚数と閉じる */}
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="text-sm font-semibold tabular-nums" aria-live="polite">
              {formatImageCounter(openIndex, photos.length)}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                close();
              }}
              aria-label="閉じる"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/15"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          {/* 写真 */}
          <div className="relative flex flex-1 items-center justify-center px-2 pb-2">
            {photos.length > 1 && (
              <NavButton side="left" onClick={() => step(-1)} />
            )}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={current.caption || `${title} の写真 ${openIndex + 1}`}
              onClick={(e) => e.stopPropagation()}
              // 拡大表示は «持ち出されやすい» 場所なので、
              // グリッドと同じ対策を個別にも掛ける。
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              onContextMenu={(e) => e.preventDefault()}
              style={{ WebkitTouchCallout: 'none' }}
              className="max-h-full max-w-full select-none object-contain"
            />

            {photos.length > 1 && <NavButton side="right" onClick={() => step(1)} />}
          </div>

          {/* キャプション */}
          {current.caption && (
            <p className="px-4 pb-4 text-center text-sm text-white/90">{current.caption}</p>
          )}

          {/* 操作方法のヒント。PC ではキー操作に気付かない人が多い。 */}
          {photos.length > 1 && (
            <p className="hidden pb-3 text-center text-[11px] text-white/50 sm:block">
              ← → キーで移動 / Esc で閉じる
            </p>
          )}
        </div>
      )}
    </>
  );
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={side === 'left' ? '前の写真' : '次の写真'}
      className={`absolute ${
        side === 'left' ? 'left-1 sm:left-3' : 'right-1 sm:right-3'
      } top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70`}
    >
      <Icon className="h-6 w-6" aria-hidden />
    </button>
  );
}
