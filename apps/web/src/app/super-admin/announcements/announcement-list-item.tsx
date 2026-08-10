'use client';

/**
 * お知らせ一覧の 1 行 (行内アクション + インライン編集フォーム)
 *
 * なぜ「行そのもの」をクライアントコンポーネントにしているか:
 *   編集フォームは行の全幅を使って開きたい。
 *   ボタン側 (右カラム) の内部にフォームを置くと、
 *   flex の右カラム幅に押し込められてタイトルが縦に潰れてしまう
 *   (実際にその崩れが出たのでこの形に直した)。
 *
 *   そのため「開いているかどうか」の state はこの行レベルで持ち、
 *   フォームは左右カラムの *下* に兄弟として描画する。
 *
 * 表示部分 (バッジ / 本文抜粋 / メール送信状況) は情報量が多く
 * サーバー側で組み立てたいので、children として受け取る。
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, SquareArrowOutUpRight } from 'lucide-react';
import { AnnouncementEditForm } from './announcement-edit-form';
import type { AnnouncementEditableFields } from '@/lib/announcement-edit';
import { SuperAdminWriteGate } from '@/components/admin/SuperAdminReadOnly';

type Status = 'DRAFT' | 'PUBLISHED';
type EmailStatus =
  | 'NOT_REQUESTED'
  | 'PENDING'
  | 'SENDING'
  | 'COMPLETED'
  | 'FAILED';

/**
 * プレビュー URL。
 *
 * 下書きは `?preview=1` を付けたときだけ運営に表示される
 * (判定は server 側の lib/announcement-visibility.ts)。
 * 他の人がこの URL を開いても 404 になるので共有しても漏れない。
 */
function previewHref(id: string, status: Status): string {
  return status === 'DRAFT' ? `/notices/${id}?preview=1` : `/notices/${id}`;
}

export function AnnouncementListItem({
  id,
  status,
  emailStatus,
  initial,
  canEdit,
  children,
}: {
  id: string;
  status: Status;
  emailStatus: EmailStatus;
  /** 編集フォームの初期値 (一覧が持っている現在の値) */
  initial: AnnouncementEditableFields;
  /** STAFF は閲覧のみなので編集 / 公開 / 削除を出さない */
  canEdit: boolean;
  /** 左カラムに表示する内容 (サーバー側で組み立てた表示用マークアップ) */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/super-admin/announcements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(j.error?.message ?? `HTTP ${res.status}`);
      return;
    }
    router.refresh();
  }

  async function remove() {
    if (!confirm('このお知らせを削除しますか？この操作は取り消せません。')) return;
    setError(null);
    const res = await fetch(`/api/super-admin/announcements/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(j.error?.message ?? `HTTP ${res.status}`);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">{children}</div>

        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {/*
              公開後と同じ見た目で確認するリンク。
              下書きでも押せるようにして「公開しないと確認できない」を解消する。
              別タブで開くのは、編集中の一覧の状態を失わないため。
            */}
            <a
              href={previewHref(id, status)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
            >
              <SquareArrowOutUpRight className="h-3.5 w-3.5" aria-hidden />
              プレビュー
            </a>

            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                disabled={pending}
                aria-expanded={editing}
                className="inline-flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                {editing ? '編集を閉じる' : '編集'}
              </button>
            )}

            {canEdit &&
              (status === 'DRAFT' ? (
                <button
                  type="button"
                  onClick={() =>
                    startTransition(() => patch({ status: 'PUBLISHED' }))
                  }
                  disabled={pending}
                  className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  公開
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    startTransition(() => patch({ status: 'DRAFT' }))
                  }
                  disabled={pending}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  下書きに戻す
                </button>
              ))}

            {canEdit && (
              <button
                type="button"
                onClick={() => startTransition(() => remove())}
                disabled={pending}
                className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
              >
                削除
              </button>
            )}
          </div>
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>
      </div>

      {/*
        編集フォームは左右カラムの下に全幅で開く。
        key に現在値を含めることで、保存後に再取得された値が
        初期値として反映される (古い入力が残らない)。
      */}
      {canEdit && editing && (
        <SuperAdminWriteGate silent>
          <AnnouncementEditForm
            key={`${id}-${initial.title}-${initial.body}-${initial.audience}-${initial.sendEmail}`}
            id={id}
            status={status}
            emailStatus={emailStatus}
            initial={initial}
            onClose={() => setEditing(false)}
          />
        </SuperAdminWriteGate>
      )}
    </>
  );
}
