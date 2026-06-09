'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  settingKey: string;
  value: string | number | boolean;
  valueType: 'boolean' | 'number' | 'string';
};

export function SettingRow({ settingKey, value, valueType }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | number | boolean>(value);
  const dirty = draft !== value;

  async function save(nextValue: string | number | boolean) {
    setError(null);
    const res = await fetch('/api/super-admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: settingKey, value: nextValue }),
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

  if (valueType === 'boolean') {
    const checked = draft as boolean;
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={pending}
          onClick={() => {
            const next = !checked;
            setDraft(next);
            startTransition(() => save(next));
          }}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:opacity-50 ${
            checked ? 'bg-rose-600' : 'bg-slate-300'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              checked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
        <span className="min-w-[3rem] text-xs font-medium text-slate-600">
          {checked ? 'ON' : 'OFF'}
        </span>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    );
  }

  if (valueType === 'number') {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={draft as number}
          disabled={pending}
          onChange={(e) => setDraft(Number(e.target.value))}
          className="w-28 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
        />
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={() => startTransition(() => save(draft))}
          className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-40"
        >
          {pending ? '保存中…' : '保存'}
        </button>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    );
  }

  // string
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={draft as string}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        className="w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
      />
      <button
        type="button"
        disabled={!dirty || pending}
        onClick={() => startTransition(() => save(draft))}
        className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-40"
      >
        {pending ? '保存中…' : '保存'}
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
