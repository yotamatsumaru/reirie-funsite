'use client';

/**
 * Pui 付与レートの編集フォーム (SUPER_ADMIN)。
 * PATCH /api/super-admin/point-rates で永続化する。
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

type Rates = {
  loginBonusBase: number;
  loginStreakBonus: number;
  loginStreakThreshold: number;
  socialSharePui: number;
};

const FIELDS: { key: keyof Rates; label: string; help: string; min: number }[] = [
  { key: 'loginBonusBase', label: '毎日のログインボーナス (Pui/日)', help: '毎日のログインで付与する基本 Pui', min: 0 },
  { key: 'loginStreakThreshold', label: '連続ログインボーナスの日数', help: 'この日数連続でボーナスを上乗せ (例: 7)', min: 2 },
  { key: 'loginStreakBonus', label: '連続ログインボーナス (Pui)', help: '連続日数に到達した日に上乗せする Pui', min: 0 },
  { key: 'socialSharePui', label: 'Xシェア (Pui/回)', help: 'X シェア 1 回 (1日1回) の付与 Pui', min: 0 },
];

export function RatesForm({ initial }: { initial: Rates }) {
  const router = useRouter();
  const [rates, setRates] = useState<Rates>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  function update(key: keyof Rates, value: string) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    setRates((r) => ({ ...r, [key]: n }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/super-admin/point-rates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rates),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(j.error?.message ?? `保存に失敗しました (HTTP ${res.status})`);
      setMessage({ tone: 'ok', text: 'Pui レートを保存しました' });
      router.refresh();
    } catch (e) {
      setMessage({ tone: 'err', text: e instanceof Error ? e.message : 'エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            message.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="rounded-lg border border-slate-200 p-4">
            <label className="block text-sm font-semibold text-slate-800">{f.label}</label>
            <p className="mt-0.5 text-xs text-slate-500">{f.help}</p>
            <input
              type="number"
              min={f.min}
              value={rates[f.key]}
              onChange={(e) => update(f.key, e.target.value)}
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button loading={saving} onClick={save}>
          保存する
        </Button>
      </div>
    </div>
  );
}
