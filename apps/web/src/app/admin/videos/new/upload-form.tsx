/**
 * 動画アップロードフォーム (Client Component)
 *
 * フロー:
 *   1) /api/admin/videos/upload-url で S3 PUT 署名URLと s3SourceKey を取得
 *   2) 署名URLへファイルを直接 PUT (進捗表示は XHR で取得)
 *   3) /api/admin/videos で Video レコードを作成 (status=UPLOADING)
 *   4) /api/admin/videos/[id]/encode で MediaConvert エンコードを開始 (status=PROCESSING)
 *   5) 詳細ページへ遷移
 */
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';

type AccessLevel = 'PUBLIC' | 'MEMBERS' | 'PREMIUM';

/** 署名URLへ XHR で PUT し、進捗を通知する */
function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`アップロードに失敗しました (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error('アップロード中に通信エラーが発生しました'));
    xhr.send(file);
  });
}

export function UploadVideoForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('MEMBERS');
  const [expiresAt, setExpiresAt] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'creating' | 'encoding'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function onPickFile(f: File | null) {
    setFile(f);
    setError(null);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  async function handleSubmit() {
    setError(null);
    if (!file) return setError('動画ファイルを選択してください');
    if (!title.trim()) return setError('タイトルを入力してください');

    setBusy(true);
    try {
      // 1) 署名URL取得
      setPhase('uploading');
      setProgress(0);
      const contentType = file.type || 'application/octet-stream';
      const presignRes = await fetch('/api/admin/videos/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType }),
      });
      if (!presignRes.ok) throw new Error('アップロードURLの取得に失敗しました');
      const { uploadUrl, s3SourceKey } = (await presignRes.json()) as {
        uploadUrl: string;
        s3SourceKey: string;
      };

      // 2) S3 へ直接 PUT
      await putWithProgress(uploadUrl, file, contentType, setProgress);

      // 3) レコード作成
      setPhase('creating');
      const createRes = await fetch('/api/admin/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          s3SourceKey,
          accessLevel,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      if (!createRes.ok) {
        const j = (await createRes.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(j.error?.message ?? '動画レコードの作成に失敗しました');
      }
      const created = (await createRes.json()) as { id: string };

      // 4) エンコード開始 (失敗しても詳細ページで再実行可能)
      setPhase('encoding');
      const encodeRes = await fetch(`/api/admin/videos/${created.id}/encode`, {
        method: 'POST',
      });
      if (!encodeRes.ok) {
        const j = (await encodeRes.json().catch(() => ({}))) as { error?: { message?: string } };
        toast.warning(
          j.error?.message ?? 'エンコードを開始できませんでした。詳細ページから再実行してください。',
          'アップロードは完了しました',
        );
      } else {
        toast.success('アップロードとエンコード開始が完了しました', '動画');
      }

      router.push(`/admin/videos/${created.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    } finally {
      setBusy(false);
    }
  }

  const phaseLabel: Record<typeof phase, string> = {
    idle: '',
    uploading: `アップロード中… ${progress}%`,
    creating: 'レコード作成中…',
    encoding: 'エンコード開始中…',
  };

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">動画ファイル</label>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            disabled={busy}
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-700"
          />
          {file && (
            <p className="mt-1 text-xs text-slate-500">
              {file.name}（{(file.size / 1024 / 1024).toFixed(1)} MB）
            </p>
          )}
        </div>

        <Input
          label="タイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          maxLength={200}
        />

        <Textarea
          label="説明（任意）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          rows={3}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="アクセス範囲"
            value={accessLevel}
            onChange={(e) => setAccessLevel(e.target.value as AccessLevel)}
            disabled={busy}
          >
            <option value="PUBLIC">全員（公開）</option>
            <option value="MEMBERS">会員（無料プラン以上）</option>
            <option value="PREMIUM">プレミアム限定</option>
          </Select>
          <Input
            type="datetime-local"
            label="配信期限（任意）"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={busy}
            hint="許諾期限がある場合に設定"
          />
        </div>

        {busy && phase !== 'idle' && (
          <div className="space-y-1">
            <p className="text-sm text-slate-600">{phaseLabel[phase]}</p>
            {phase === 'uploading' && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-brand-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSubmit} loading={busy} disabled={busy}>
            アップロードしてエンコード開始
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
