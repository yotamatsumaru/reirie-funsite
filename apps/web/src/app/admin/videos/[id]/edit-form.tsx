/**
 * 動画メタ情報の編集フォーム（Client Component）
 *
 * タイトル / 説明文 / 公開範囲 / 公開開始日時 / 配信期限 / サムネイルを
 * 後から直せるようにする。
 * アップロード時にファイル名が仮タイトルとして入るため、
 * ここで直せないとファイル名がそのまま会員に見えてしまう。
 *
 * ## 設計メモ
 * - 既定は閲覧モード。「編集」を押して初めて入力可能にする
 *   （一覧から流れてきて誤って書き換える事故を防ぐ）。
 * - 保存は差分のみ送る（buildVideoEditPatch）。触っていない項目は送らないので
 *   同時編集時に他人の変更を巻き戻さない。
 * - 検証ロジック・日時変換は lib/video-edit.ts の純粋関数に寄せてテスト済み。
 * - 公開 / 非公開のスイッチ（isPublished）はここでは扱わない
 *   （専用の visibility API がある）。保存操作で公開状態が
 *   意図せず変わる事故を避けるため。
 *
 * ## 公開開始日時（publishedAt）をここで扱う理由
 * スイッチの ON/OFF と違い、日時は「いつから見せるか」という
 * 予定の入力であり、保存した瞬間に公開状態が反転するわけではない。
 * 配信期限（expiresAt）と対で入力したい項目なので同じフォームに置く。
 *
 * ## サムネイルだけ「保存」を待たず即時反映する理由
 * 画像のアップロードは multipart なので、テキストの差分 PATCH（JSON）と
 * 同じ送信には乗せられない。ファイルを state に抛えて保留する道もあるが、
 * 「選んだのに反映されていない」状態が見た目上分からず事故になるので、
 * 選んだ時点で即 POST し、結果の URL をプレビューに反映する。
 * （サムネイルは公開範囲を変えないので、即時反映でも危険な副作用がない。）
 */
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { AccessLevelSelect } from '@/components/admin/AccessLevelSelect';
import { toast } from '@/stores/ui-store';
import {
  buildVideoEditPatch,
  isEmptyPatch,
  validateVideoEdit,
  toDatetimeLocalJst,
  fromDatetimeLocalJst,
  VIDEO_TITLE_MAX,
  VIDEO_DESCRIPTION_MAX,
  type VideoEditFormValues,
} from '@/lib/video-edit';

/**
 * サムネイルのプレビュー。
 *
 * `next/image` ではなく素の `<img>` を使う。表示側 (`me/videos`, `/contents`) も
 * 同じ理由で素の `<img>` を使っており、S3 プリサインド URL や
 * 内部パス `/api/media/video-thumbnail/...` は `images.remotePatterns` /
 * `localPatterns` に列挙できない（署名クエリ付き・ホストが環境依存）ため。
 */
function ThumbnailPreview({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="flex aspect-video w-full max-w-xs items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">
        未設定（一覧ではプレースホルダーが表示されます）
      </div>
    );
  }
  return (
    <div className="w-full max-w-xs overflow-hidden rounded-md border border-slate-200 bg-slate-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="サムネイル" className="aspect-video w-full object-cover" />
    </div>
  );
}

// 公開範囲の選択肢とラベルは AccessLevelSelect（→ @idol/shared）に集約している。
// 以前はここにローカルな ACCESS_LABEL を持っており、アップロード画面と
// 同じ値に別の表記を当てていた。

export function VideoEditForm({
  videoId,
  title,
  description,
  accessLevel,
  publishedAt,
  expiresAt,
  thumbnailUrl,
  thumbnailPreviewUrl,
}: {
  videoId: string;
  title: string;
  description: string | null;
  accessLevel: string;
  /** 公開開始日時。ISO 文字列 or null */
  publishedAt: string | null;
  /** ISO 文字列 or null */
  expiresAt: string | null;
  /** DB に入っている生の値（S3 キー / 絶対URL / 内部パス） */
  thumbnailUrl: string | null;
  /**
   * 表示用に解決済みの URL。
   * 生の値が S3 キーの場合はそのまま `<img src>` に入れても表示できないので、
   * サーバで署名済み URL に直したものを別途受け取る。
   */
  thumbnailPreviewUrl: string | null;
}) {
  const router = useRouter();

  // サーバーから来た値を編集フォームの初期値へ正規化する。
  const initial: VideoEditFormValues = {
    title,
    description: description ?? '',
    accessLevel,
    publishedAt: toDatetimeLocalJst(publishedAt),
    expiresAt: toDatetimeLocalJst(expiresAt),
    thumbnailUrl: thumbnailUrl ?? '',
  };

  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<VideoEditFormValues>(initial);
  const [saving, setSaving] = useState(false);
  // アップロード後はその URL を、未アップロードならサーバ解決済みの URL を使う。
  const [preview, setPreview] = useState<string | null>(thumbnailPreviewUrl);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function set<K extends keyof VideoEditFormValues>(key: K, value: VideoEditFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // 入力中の値が未来日時なら「予約公開になる」と即座に伝える。
  // 保存後のメッセージだけだと、入力の時点で気付けず取り違えやすい。
  // Date 比較は描画時評価でよい（秒単位の精度は不要）。
  const publishedIso = values.publishedAt.trim()
    ? fromDatetimeLocalJst(values.publishedAt)
    : null;
  const scheduledHint =
    publishedIso && new Date(publishedIso) > new Date()
      ? '⏰ 未来の日時です。この時刻になるまで会員側には表示されません（公開予約）'
      : null;

  function cancel() {
    // 編集を破棄してサーバーの値に戻す。
    // なお画像のアップロードは即時保存なのでキャンセルでは戻らない
    // （戻すなら削除ボタンで明示的に消してもらう）。
    setValues(initial);
    setEditing(false);
  }

  /**
   * 画像を選んだときのアップロード。
   *
   * S3 アセットバケットが設定されていない環境でも DB に保存されるので、
   * AWS 側の設定なしでこの導線は常に使える。
   */
  async function uploadThumbnail(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/admin/videos/${videoId}/thumbnail`, {
        method: 'POST',
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as {
        thumbnailUrl?: string;
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok || !j.thumbnailUrl) {
        throw new Error(
          j.error?.message ??
            '画像のアップロードに失敗しました。下の欄に画像URLを直接入力することもできます。',
        );
      }
      // 保存済みなので差分に乗せないよう values と initial 両方の意図を揃える。
      // （router.refresh() でサーバから新しい値が降ってくる）
      set('thumbnailUrl', j.thumbnailUrl);
      setPreview(j.thumbnailUrl);
      toast.success(j.message ?? 'サムネイルを設定しました', '動画');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message, 'エラー');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /** サムネイルを未設定に戻す。 */
  async function removeThumbnail() {
    if (!window.confirm('サムネイルを削除しますか？')) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/admin/videos/${videoId}/thumbnail`, { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(j.error?.message ?? '削除に失敗しました');
      set('thumbnailUrl', '');
      setPreview(null);
      toast.success(j.message ?? 'サムネイルを削除しました', '動画');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message, 'エラー');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    const check = validateVideoEdit(values, initial);
    if (!check.ok) {
      toast.error(check.message, '入力エラー');
      return;
    }

    const patch = buildVideoEditPatch(initial, values);
    if (isEmptyPatch(patch)) {
      toast.info('変更はありません', '動画');
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/videos/${videoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(j.error?.message ?? '保存に失敗しました');
      toast.success(j.message ?? '保存しました', '動画');
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message, 'エラー');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">
              サムネイル / タイトル / 説明文
            </h2>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              編集
            </Button>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-slate-400">サムネイル</p>
            <ThumbnailPreview url={preview} />
          </div>
          <div>
            <p className="text-xs text-slate-400">タイトル</p>
            <p className="text-sm font-medium text-slate-800">{title}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">説明文</p>
            {description ? (
              <p className="whitespace-pre-wrap text-sm text-slate-700">{description}</p>
            ) : (
              <p className="text-sm text-slate-400">（未設定）</p>
            )}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-800">
          サムネイル / タイトル / 説明文を編集
        </h2>
      </CardHeader>
      <CardBody className="space-y-4">
        {/*
          サムネイルはアップロードした時点で保存される（「保存」ボタン待ちではない）。
          multipart と JSON 差分 PATCH を 1 回の送信に混ぜられないため。
        */}
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-xs font-medium text-slate-600">サムネイル</p>
          <ThumbnailPreview url={preview} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              画像をアップロード（JPEG / PNG / WebP・8MB まで）
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading || saving}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadThumbnail(f);
              }}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            />
          </label>
          <p className="text-xs text-slate-500">
            {uploading ? 'アップロード中…' : '選ぶとすぐに反映されます（「保存」は不要）'}
          </p>
          <Input
            label="または画像URLを直接入力"
            name="thumbnailUrl"
            value={values.thumbnailUrl}
            onChange={(e) => set('thumbnailUrl', e.target.value)}
            placeholder="https://…"
            hint="こちらは「保存」を押すと反映されます。空にするとサムネイルなしになります"
          />
          {preview && (
            <Button
              variant="ghost"
              size="sm"
              onClick={removeThumbnail}
              disabled={uploading || saving}
            >
              サムネイルを削除
            </Button>
          )}
        </div>

        <Input
          label="タイトル"
          name="title"
          value={values.title}
          maxLength={VIDEO_TITLE_MAX}
          onChange={(e) => set('title', e.target.value)}
          hint={`${values.title.length} / ${VIDEO_TITLE_MAX} 文字`}
        />

        <Textarea
          label="説明文"
          name="description"
          rows={5}
          value={values.description}
          maxLength={VIDEO_DESCRIPTION_MAX}
          onChange={(e) => set('description', e.target.value)}
          hint={`${values.description.length} / ${VIDEO_DESCRIPTION_MAX} 文字・空にすると説明なしになります`}
        />

        <AccessLevelSelect
          value={values.accessLevel}
          onChange={(v) => set('accessLevel', v)}
        />

        <Input
          label="公開開始日時"
          name="publishedAt"
          type="datetime-local"
          value={values.publishedAt}
          onChange={(e) => set('publishedAt', e.target.value)}
          hint={
            scheduledHint ??
            '日本時間で指定します。未来の日時にすると、その時刻まで会員側に表示されません（公開予約）'
          }
        />

        <Input
          label="配信期限"
          name="expiresAt"
          type="datetime-local"
          value={values.expiresAt}
          onChange={(e) => set('expiresAt', e.target.value)}
          hint="日本時間で指定します。空にすると期限なしになります"
        />

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} loading={saving} disabled={saving}>
            保存
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={saving}>
            キャンセル
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
