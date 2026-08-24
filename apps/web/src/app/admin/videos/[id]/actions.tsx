/**
 * 動画詳細ページの操作 (Client Component)
 *   - エンコード開始 / 再エンコード (MediaConvert)
 *   - エンコード状態の確認 (MediaConvert / S3 に直接問い合わせて READY 化)
 *   - プレビュー再生 (READY のとき)
 *   - 手動公開 (MediaConvert 完了通知が来ない場合のフォールバック)
 *
 * ## 「エンコード状態を確認」がある理由 (重要)
 * MediaConvert は完了を push 通知しない。完了通知の Lambda / EventBridge が
 * 未整備だと Video は PROCESSING のまま止まる。従来は「手動で公開」が
 * `hasHls` (= s3HlsKey が埋まっていること) を条件にしていたため、
 *   完了通知が来ない → s3HlsKey が空 → ボタンが出ない → 待つしかない
 * というデッドロックだった。この確認ボタンは Lambda に依存せず
 * AWS の実状から状態を確定させるため、常に押せるようにしてある。
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
  isPublished,
}: {
  videoId: string;
  status: string;
  hasHls: boolean;
  /** 動画単位の公開スイッチの現在値 */
  isPublished: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<
    null | 'encode' | 'publish' | 'preview' | 'sync' | 'visibility'
  >(null);
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

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

  /**
   * MediaConvert / S3 に直接問い合わせて状態を反映する。
   * 完了していれば READY 化、失敗していれば FAILED 化、
   * 進行中なら進捗率を表示する。
   */
  async function syncStatus() {
    setBusy('sync');
    setSyncMessage(null);
    try {
      const res = await fetch(`/api/admin/videos/${videoId}/sync`, { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as {
        changed?: boolean;
        status?: string;
        message?: string;
        progressPercent?: number;
        jobLookupError?: string;
        s3CheckError?: string;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(j.error?.message ?? '状態の確認に失敗しました');

      const msg = j.message ?? '状態を確認しました';
      setSyncMessage(
        [msg, j.jobLookupError && `ジョブ照会エラー: ${j.jobLookupError}`,
          j.s3CheckError && `S3 確認エラー: ${j.s3CheckError}`]
          .filter(Boolean)
          .join(' / '),
      );

      if (j.changed) {
        toast.success(msg, '動画');
        router.refresh();
      } else {
        // 状態が変わらない場合も原因が分かるよう info で見せる
        toast.info(msg, '動画');
      }
    } catch (e) {
      toast.error((e as Error).message, 'エラー');
    } finally {
      setBusy(null);
    }
  }

  /**
   * 動画単位の公開 / 非公開を切り替える。
   * status (エンコード進行状況) とは別軸なので、PROCESSING 中でも操作できる。
   */
  async function toggleVisibility() {
    setBusy('visibility');
    try {
      const res = await fetch(`/api/admin/videos/${videoId}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: !isPublished }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(j.error?.message ?? '切り替えに失敗しました');
      toast.success(j.message ?? '切り替えました', '動画');
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
        {/* 公開 / 非公開は運営の意思で切るスイッチなので、エンコード操作と分けて先頭に置く */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-slate-800">
              {isPublished ? '公開中' : '非公開'}
            </p>
            <p className="text-xs text-slate-500">
              {isPublished
                ? '会員向けの一覧に表示されます'
                : '会員向けの一覧・詳細・再生から除外されます'}
            </p>
          </div>
          <Button
            variant={isPublished ? 'outline' : 'primary'}
            onClick={toggleVisibility}
            loading={busy === 'visibility'}
            disabled={busy !== null}
          >
            {isPublished ? '非公開にする' : '公開する'}
          </Button>
        </div>

        {isPublished && status !== 'READY' && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            公開設定ですがエンコードが未完了（{status}）のため、まだ会員には表示されません。
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={startEncode}
            loading={busy === 'encode'}
            disabled={busy !== null || status === 'PROCESSING'}
          >
            {status === 'FAILED' || hasHls ? '再エンコード' : 'エンコード開始'}
          </Button>

          {/*
            状態確認は s3HlsKey の有無に依存させない。
            これが従来のデッドロック (完了通知が来ないと何も操作できない) の解消点。
          */}
          {status !== 'READY' && (
            <Button
              variant="primary"
              onClick={syncStatus}
              loading={busy === 'sync'}
              disabled={busy !== null}
            >
              エンコード状態を確認
            </Button>
          )}

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
              variant="secondary"
              onClick={publish}
              loading={busy === 'publish'}
              disabled={busy !== null}
            >
              手動で公開（READY化）
            </Button>
          )}
        </div>

        {syncMessage && (
          <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            {syncMessage}
          </p>
        )}

        {status === 'PROCESSING' && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            エンコード中です。完了すると自動で READY になります。
            自動反映が有効でない場合は「エンコード状態を確認」を押すと、
            MediaConvert に直接問い合わせて反映します。
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
