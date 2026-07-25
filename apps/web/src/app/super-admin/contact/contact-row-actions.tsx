/**
 * お問い合わせ行の操作 (Client Component)
 *  - 対応状況の変更
 *  - 管理メモの編集
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
  type ContactStatusLiteral,
} from '@idol/shared';

export function ContactRowActions({
  contactId,
  status,
  adminNote,
}: {
  contactId: string;
  status: ContactStatusLiteral;
  adminNote: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(adminNote ?? '');
  const [savedNote, setSavedNote] = useState(adminNote ?? '');

  async function callApi(bodyObj: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/super-admin/contact/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(j.error?.message ?? `HTTP ${res.status}`);
      return false;
    }
    return true;
  }

  function handleStatusChange(next: ContactStatusLiteral) {
    startTransition(async () => {
      const ok = await callApi({ status: next });
      if (ok) router.refresh();
    });
  }

  function handleSaveNote() {
    startTransition(async () => {
      const ok = await callApi({ adminNote: note });
      if (ok) {
        setSavedNote(note);
        router.refresh();
      }
    });
  }

  const noteDirty = note !== savedNote;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-500">対応状況</label>
        <select
          value={status}
          disabled={pending}
          onChange={(e) => handleStatusChange(e.target.value as ContactStatusLiteral)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
        >
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CONTACT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <textarea
          value={note}
          disabled={pending}
          rows={2}
          placeholder="管理メモ (対応記録など)"
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSaveNote}
            disabled={pending || !noteDirty}
            className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            メモを保存
          </button>
          {noteDirty && <span className="text-xs text-amber-600">未保存</span>}
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}
