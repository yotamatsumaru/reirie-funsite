/**
 * 動画詳細ページの操作 (Client Component)
 *   - エンコード開始 / 再エンコード (MediaConvert)
 *   - プレビュー再生 (READY のとき)
 *   - 手動公開 (MediaConvert 完了通知が来ない場合のフォールバック)
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';
import { HlsPlayer } from '@/components/video/HlsPlayer';

export function VideoAdminActions({
  videoId,
  status,
  hasHls,
}: {
  videoId: string;
  status: string;
  hasHls: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'encode' | 'publish' | 'preview'>(null);
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);

  async function startEncode() {
    setBusy('encode');
    try {
      const res = await fetch(`/api/admin/videos/${videoId}/encode`, { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(j.error?.message ?? 'エンコード開始に失敗しました');
      toast.success('エンコードを開始しました', '動画');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message, 'エラー');
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    setBusy('publish');
    try {
      const res = await fetch(`/api/admin/videos/${videoId}/publish`, { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(j.error?.message ?? '公開に失敗しました');
      toast.success('公開しました', '動画');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message, 'エラー');
    } finally {
      setBusy(null);
    }
  }

  async function preview() {
    setBusy('preview');
    try {
      const res = await fetch(`/api/videos/${videoId}/playback`, { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as {
        hlsUrl?: string;
        error?: { message?: string };
      };
      if (!res.ok || !j.hlsUrl) throw new Error(j.error?.message ?? 'プレビューを取得できません');
      setHlsUrl(j.hlsUrl);
    } catch (e) {
      toast.error((e as Error).message, 'エラー');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-800">操作</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={startEncode}
            loading={busy === 'encode'}
            disabled={busy !== null || status === 'PROCESSING'}
          >
            {status === 'FAILED' || hasHls ? '再エンコード' : 'エンコード開始'}
          </Button>

          {hasHls && (
            <Button
              variant="outline"
              onClick={preview}
              loading={busy === 'preview'}
              disabled={busy !== null}
            >
              プレビュー再生
            </Button>
          )}

          {hasHls && status !== 'READY' && (
            <Button
              variant="primary"
              onClick={publish}
              loading={busy === 'publish'}
              disabled={busy !== null}
            >
              手動で公開（READY化）
            </Button>
          )}
        </div>

        {status === 'PROCESSING' && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            エンコード中です。完了すると自動で READY になります（MediaConvert 完了通知の
            Lambda が未整備の場合は、完了後に「手動で公開」を押してください）。
          </p>
        )}

        {hlsUrl && (
          <div className="overflow-hidden rounded-lg bg-black">
            <HlsPlayer src={hlsUrl} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
