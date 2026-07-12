'use client';

/**
 * あっち向いてホイ「設定」(パチンコ風 1〜6) のプラン別編集 UI (SUPER_ADMIN)。
 *
 * 設定値が大きいほどプレイヤーが勝ちやすい。プラン (FREE/STANDARD/PREMIUM) ごとに
 * 設定を割り当て、PATCH /api/super-admin/acchi-settings で永続化する。
 */
import { useState } from 'react';
import {
  PLAN_TYPES,
  PLAN_LABELS,
  ACCHI_WIN_SETTINGS,
  ACCHI_WIN_RATE_BY_SETTING,
  type AcchiWinSetting,
  type AcchiWinSettingsByPlan,
  type PlanTypeLiteral,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';

function ratePct(setting: AcchiWinSetting): string {
  return `${Math.round(ACCHI_WIN_RATE_BY_SETTING[setting] * 100)}%`;
}

export function AcchiSettingsClient({ initial }: { initial: AcchiWinSettingsByPlan }) {
  const [settings, setSettings] = useState<AcchiWinSettingsByPlan>(initial);
  const [saving, setSaving] = useState(false);

  function update(plan: PlanTypeLiteral, value: AcchiWinSetting) {
    setSettings((s) => ({ ...s, [plan]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/super-admin/acchi-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '保存に失敗しました');
      }
      setSettings(json.settings as AcchiWinSettingsByPlan);
      toast.success('あっち向いてホイの設定を保存しました');
    } catch (e) {
      toast.error((e as Error).message, '保存エラー');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-800">
          あっち向いてホイ 勝率設定 (パチンコ風 設定 1〜6)
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          プランごとに「設定」を割り当てます。数字が大きいほどプレイヤーが勝ちやすくなります
          (設定6 が最も勝ちやすい高設定)。
        </p>
      </CardHeader>
      <CardBody>
        <div className="space-y-4">
          {PLAN_TYPES.map((plan) => {
            const current = settings[plan];
            return (
              <div
                key={plan}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-semibold text-slate-800">{PLAN_LABELS[plan]}</p>
                  <p className="text-xs text-slate-500">
                    現在: 設定{current}（勝率 約{ratePct(current)}）
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500" htmlFor={`acchi-setting-${plan}`}>
                    設定
                  </label>
                  <select
                    id={`acchi-setting-${plan}`}
                    value={current}
                    onChange={(e) =>
                      update(plan, Number(e.target.value) as AcchiWinSetting)
                    }
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-twilight-amethyst focus:outline-none"
                  >
                    {ACCHI_WIN_SETTINGS.map((s) => (
                      <option key={s} value={s}>
                        設定{s}（約{ratePct(s)}）
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-end">
          <Button onClick={save} loading={saving} variant="primary">
            設定を保存
          </Button>
        </div>

        <p className="mt-3 text-xs text-slate-400">
          ※ 勝率はサーバー側で厳密に適用されます。プランは会員の有効サブスクリプションから判定されます。
        </p>
      </CardBody>
    </Card>
  );
}
