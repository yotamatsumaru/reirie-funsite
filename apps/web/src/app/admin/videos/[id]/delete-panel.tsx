/**
 * 動画削除パネル (Client Component)。
 *
 * ## なぜ「操作」カードと分けているか
 * 同じカードに置くと、エンコード開始やプレビューと同じ見た目のボタンが並び、
 * 押し間違いが起きる。削除だけは取り消せないため、
 * 赤枠の独立したカードにして「ここから先は危険」と視覚的に区切る。
 *
 * ## なぜ confirm() ではなくタイトル入力なのか
 * ブラウザの confirm は Enter で確定できてしまい、
 * 一覧から誤った行を開いたまま反射的に押してしまうと復旧できない
 * (S3 の実体まで消えるので再アップロードしか手が無い)。
 * タイトルを手で打たせることで「今どの動画を消そうとしているか」を
 * 必ず一度読ませる。
 *
 * ## 視聴回数を出している理由
 * 「テスト用に上げた動画」と「会員が実際に見ている動画」を取り違えると
 * 被害が大きく違う。消す前の判断材料として件数を見せる。
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';
import { isDeleteConfirmationValid } from '@/lib/video-delete';

export function VideoDeletePanel({
  videoId,
  title,
  viewCount,
}: {
  videoId: string;
  title: string;
  /** 削除の重さを判断してもらうための視聴ログ件数 */
  viewCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const canDelete = isDeleteConfirmationValid(input, title);

  async function remove() {
    // ボタン側でも disabled にしているが、
    // Enter キー等の別経路で発火した場合に備えて二重に確認する。
    if (!canDelete) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/videos/${videoId}`, { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as {
        message?: string;
        storageWarning?: boolean;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(j.error?.message ?? '削除に失敗しました');

      // S3 の削除に失敗しても DB からは消えている。
      // 「失敗」と伝えると運営が再実行して混乱するので、警告として出す。
      if (j.storageWarning) {
        toast.info(j.message ?? '動画を削除しました', '動画');
      } else {
        toast.success(j.message ?? '動画を削除しました', '動画');
      }

      // 削除後の詳細ページは 404 になるため一覧へ戻す。
      // refresh を挟むのは、一覧のキャッシュに消した行が残らないようにするため。
      router.replace('/admin/videos');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message, 'エラー');
      setBusy(false);
    }
  }

  return (
    <Card className="border-rose-200">
      <CardHeader>
        <h2 className="text-sm font-semibold text-rose-700">動画の削除</h2>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-slate-600">
          動画のデータと、アップロードした動画ファイル・変換済みの再生用ファイル・
          サムネイル画像をまとめて削除します。視聴履歴（{viewCount} 件）も削除されます。
          <span className="font-semibold text-rose-700">この操作は取り消せません。</span>
        </p>
        <p className="text-xs text-slate-500">
          一時的に見せたくないだけであれば、上の「非公開にする」を使ってください。
        </p>

        {!open ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            削除する
          </Button>
        ) : (
          <div className="space-y-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-3">
            {/*
              タイトルは打ち直す対象なので、本文に混ぜず独立した行で見せる。
              管理画面はダークモードを持ち、色 (text-rose-700) だけで
              強調するとテーマによってコントラストが落ちるため、
              枠線と太字でも区別できるようにしている。
            */}
            <label className="block space-y-1.5">
              <span className="block text-xs text-slate-700">
                削除するには、下の動画タイトルをそのまま入力してください。
              </span>
              <span className="block select-all break-all rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs font-bold text-slate-900">
                {title}
              </span>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={busy}
                autoComplete="off"
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-rose-400 focus:outline-none"
                placeholder="タイトルを入力"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                onClick={remove}
                loading={busy}
                disabled={!canDelete || busy}
              >
                完全に削除する
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setInput('');
                }}
                disabled={busy}
              >
                キャンセル
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
