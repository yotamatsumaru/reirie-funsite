/**
 * 動画メタ情報の編集フォーム（Client Component）
 *
 * タイトル / 説明文 / 公開範囲 / 配信期限を後から直せるようにする。
 * アップロード時にファイル名が仮タイトルとして入るため、
 * ここで直せないとファイル名がそのまま会員に見えてしまう。
 *
 * ## 設計メモ
 * - 既定は閲覧モード。「編集」を押して初めて入力可能にする
 *   （一覧から流れてきて誤って書き換える事故を防ぐ）。
 * - 保存は差分のみ送る（buildVideoEditPatch）。触っていない項目は送らないので
 *   同時編集時に他人の変更を巻き戻さない。
 * - 検証ロジック・日時変換は lib/video-edit.ts の純粋関数に寄せてテスト済み。
 * - 公開 / 非公開はここでは扱わない（専用の visibility API がある）。
 *   保存操作で公開状態が意図せず変わる事故を避けるため。
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { toast } from '@/stores/ui-store';
import {
  buildVideoEditPatch,
  isEmptyPatch,
  validateVideoEdit,
  toDatetimeLocalJst,
  VIDEO_TITLE_MAX,
  VIDEO_DESCRIPTION_MAX,
  type VideoEditFormValues,
} from '@/lib/video-edit';

const ACCESS_LABEL: Record<string, string> = {
  PUBLIC: '全員（無料会員・未ログインも視聴可）',
  MEMBERS: '会員限定（スタンダード以上）',
  PREMIUM: 'プレミアム限定',
};

export function VideoEditForm({
  videoId,
  title,
  description,
  accessLevel,
  expiresAt,
}: {
  videoId: string;
  title: string;
  description: string | null;
  accessLevel: string;
  /** ISO 文字列 or null */
  expiresAt: string | null;
}) {
  const router = useRouter();

  // サーバーから来た値を編集フォームの初期値へ正規化する。
  const initial: VideoEditFormValues = {
    title,
    description: description ?? '',
    accessLevel,
    expiresAt: toDatetimeLocalJst(expiresAt),
  };

  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<VideoEditFormValues>(initial);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof VideoEditFormValues>(key: K, value: VideoEditFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function cancel() {
    // 編集を破棄してサーバーの値に戻す。
    setValues(initial);
    setEditing(false);
  }

  async function save() {
    const check = validateVideoEdit(values);
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
            <h2 className="text-sm font-semibold text-slate-800">タイトル / 説明文</h2>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              編集
            </Button>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
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
        <h2 className="text-sm font-semibold text-slate-800">タイトル / 説明文を編集</h2>
      </CardHeader>
      <CardBody className="space-y-4">
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

        <Select
          label="公開範囲"
          name="accessLevel"
          value={values.accessLevel}
          onChange={(e) => set('accessLevel', e.target.value)}
        >
          {Object.entries(ACCESS_LABEL).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </Select>

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
