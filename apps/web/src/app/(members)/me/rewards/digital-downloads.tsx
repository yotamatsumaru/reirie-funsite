/**
 * 交換済みデジタル特典のダウンロードセクション (Client Component)。
 *  - マウント時に /api/me/reward-downloads を取得。
 *  - 交換直後に再取得できるよう refreshKey を props で受け取る。
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

export function DigitalDownloads({ refreshKey = 0 }: { refreshKey?: number }) {
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
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-slate-800">交換済みデジタル特典</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          交換したデジタル特典（壁紙など）をダウンロードできます。
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
