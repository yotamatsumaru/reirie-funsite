/**
 * 交換済みデジタル特典のダウンロードセクション (Client Component)。
 *  - マウント時に /api/me/reward-downloads を取得。
 *  - 交換直後に再取得できるよう refreshKey を props で受け取る。
 *
 * 【再ダウンロードについて】
 * ダウンロード回数に上限はない (機種変更・PC 買い換え・ファイル紛失に備える)。
 * 交換は 1 回だけだがダウンロードは何度でも無料 — この 2 つはセットの仕様なので、
 * 画面にもはっきり書いておく (書かないと「交換済み」が損に見える)。
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

type DownloadFile = {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
};

type DownloadItem = {
  catalogItemId: string;
  itemName: string;
  redeemedAt: string | null;
  files: DownloadFile[];
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DigitalDownloads({
  refreshKey = 0,
  anchorId,
}: {
  refreshKey?: number;
  /** カタログ側の「再ダウンロードへ」リンクから飛んでくるための id */
  anchorId?: string;
}) {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/me/reward-downloads', { cache: 'no-store' });
      if (!res.ok) throw new Error('ダウンロード情報の取得に失敗しました');
      const data = (await res.json()) as { items: DownloadItem[] };
      setItems(data.items ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // 交換済みデジタル特典が無いときはセクションごと非表示
  if (!loading && !error && items.length === 0) return null;

  return (
    <section id={anchorId} className="scroll-mt-20 space-y-3">
      <div>
        <h2 className="text-lg font-bold text-slate-800">交換済みデジタル特典</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          交換したデジタル特典（壁紙など）をダウンロードできます。
        </p>
        <p className="mt-1 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          一度交換した特典は、<strong>Pui を使わずに何度でも再ダウンロードできます</strong>。
          機種変更やファイルをなくしてしまった場合でも、もう一度交換する必要はありません。
        </p>
      </div>

      {loading && (
        <Card>
          <CardBody className="text-center text-sm text-slate-400">読み込み中…</CardBody>
        </Card>
      )}

      {error && (
        <Card>
          <CardBody className="text-center text-sm text-rose-600">{error}</CardBody>
        </Card>
      )}

      {!loading &&
        !error &&
        items.map((item) => (
          <Card key={item.catalogItemId}>
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge tone="info">デジタル特典</Badge>
                <p className="font-semibold text-slate-800">{item.itemName}</p>
              </div>

              {item.files.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                  ファイルは準備中です。公開までしばらくお待ちください。
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {item.files.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {f.fileName}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {f.contentType} · {formatSize(f.fileSize)}
                        </p>
                      </div>
                      <a
                        href={`/api/me/reward-downloads/${f.id}`}
                        download={f.fileName}
                        className="shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                        title="何度でも無料でダウンロードできます"
                      >
                        ダウンロード
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ))}
    </section>
  );
}
