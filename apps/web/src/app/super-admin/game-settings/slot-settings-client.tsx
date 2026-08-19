'use client';

/**
 * スロット「設定」(パチスロ風 1〜6) のプラン別編集 UI (SUPER_ADMIN)。
 *
 * 設定値が大きいほど当たりやすい (= 出玉率が高い)。プラン (FREE/STANDARD/PREMIUM)
 * ごとに設定を割り当て、PATCH /api/super-admin/slot-settings で永続化する。
 *
 * 【なぜ期待値まで表示するか】
 * 「当選率」だけ見て設定を上げると、実際には 1 日あたりの Pui 配布量が跳ね上がり、
 * ポイント経済が壊れることがある。設定変更の影響が数字で分かるよう、
 * 当選率に加えて「1 プレイの期待 Pui」と「1 日の期待 Pui (上限まで遊んだ場合)」を出す。
 */
import { useState } from 'react';
import {
  PLAN_TYPES,
  PLAN_LABELS,
  SLOT_SETTINGS,
  SLOT_MAX_PLAYS_PER_DAY,
  slotTotalWinRate,
  slotExpectedValue,
  type SlotSetting,
  type SlotSettingsByPlan,
  type PlanTypeLiteral,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';

/** 当選率 (何かしらの役に当たる確率) を % 表記にする */
function winPct(setting: SlotSetting): string {
  return `${(slotTotalWinRate(setting) * 100).toFixed(1)}%`;
}

/** 1 プレイあたりの期待獲得 Pui (ベース値) */
function evPerPlay(setting: SlotSetting): string {
  return slotExpectedValue(setting).toFixed(1);
}

/** 1 日 (上限まで遊んだ場合) の期待獲得 Pui (ベース値) */
function evPerDay(setting: SlotSetting): string {
  return (slotExpectedValue(setting) * SLOT_MAX_PLAYS_PER_DAY).toFixed(0);
}

export function SlotSettingsClient({ initial }: { initial: SlotSettingsByPlan }) {
  const [settings, setSettings] = useState<SlotSettingsByPlan>(initial);
  const [saving, setSaving] = useState(false);

  function update(plan: PlanTypeLiteral, value: SlotSetting) {
    setSettings((s) => ({ ...s, [plan]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/super-admin/slot-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '保存に失敗しました');
      }
      setSettings(json.settings as SlotSettingsByPlan);
      toast.success('スロットの設定を保存しました');
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
          スロット 出玉設定 (パチスロ風 設定 1〜6)
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          プランごとに「設定」を割り当てます。数字が大きいほど当たりやすくなります
          (設定6 が最も出やすい高設定)。
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
                    現在: 設定{current}（当選率 約{winPct(current)} / 1プレイ期待{' '}
                    {evPerPlay(current)} Pui）
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    1日 {SLOT_MAX_PLAYS_PER_DAY} 回すべて遊んだ場合の期待値: 約{' '}
                    {evPerDay(current)} Pui
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500" htmlFor={`slot-setting-${plan}`}>
                    設定
                  </label>
                  <select
                    id={`slot-setting-${plan}`}
                    value={current}
                    onChange={(e) => update(plan, Number(e.target.value) as SlotSetting)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-twilight-amethyst focus:outline-none"
                  >
                    {SLOT_SETTINGS.map((s) => (
                      <option key={s} value={s}>
                        設定{s}（約{winPct(s)} / {evPerPlay(s)} Pui）
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
          ※ 抽選はサーバー側で厳密に適用されます。プランは会員の有効サブスクリプションから判定されます。
        </p>
        <p className="mt-1 text-xs text-slate-400">
          ※ 表示している期待値は基本配当ベースです。実際にはプラン別の Pui 付与率
          (FREE ×1.0 / スタンダード ×1.2 / プレミアム ×2.0) が上乗せされます。
        </p>
      </CardBody>
    </Card>
  );
}
