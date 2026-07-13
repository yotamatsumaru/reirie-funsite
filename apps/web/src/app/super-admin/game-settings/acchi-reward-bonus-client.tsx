'use client';

/**
 * あっちむいてPUI「勝利特典ポイントボーナス」の編集 UI (SUPER_ADMIN)。
 *
 * Fan ポイントは無料で貯まるため、それを使って遊ぶゲームの勝利報酬を
 * そのまま課金経済圏 (特典ポイント) に交換できてしまうと経済バランスが崩れる。
 * そのため「1勝あたりの付与量 (perWin)」と「1日の上限 (dailyCap)」の
 * 2 つのパラメータで、薄い還元率 + 上限のセーフティを管理者が調整できるようにする。
 *
 * PATCH /api/super-admin/acchi-reward-bonus で永続化 (AppSetting: acchi.rewardBonusSettings)。
 */
import { useState } from 'react';
import type { AcchiRewardBonusSettings } from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';

export function AcchiRewardBonusClient({ initial }: { initial: AcchiRewardBonusSettings }) {
  const [settings, setSettings] = useState<AcchiRewardBonusSettings>(initial);
  const [saving, setSaving] = useState(false);

  const disabled = settings.perWin <= 0 || settings.dailyCap <= 0;

  function update(field: keyof AcchiRewardBonusSettings, raw: string) {
    const n = Number(raw);
    const value = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    setSettings((s) => ({ ...s, [field]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/super-admin/acchi-reward-bonus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '保存に失敗しました');
      }
      setSettings(json.settings as AcchiRewardBonusSettings);
      toast.success('勝利特典ポイントボーナスの設定を保存しました');
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
          あっちむいてPUI 勝利特典ポイントボーナス
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          勝利すると Fan ポイントとは別枠で、少量の特典ポイントも付与できます。
          Fan ポイントは無料で貯まるため、経済バランスを崩さないよう
          「薄い還元率」と「1日の上限」の両方で抑制してください。
          いずれかを 0 にすると、このボーナス機能を無効化できます。
        </p>
      </CardHeader>
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <label
              className="mb-1 block text-xs font-semibold text-slate-600"
              htmlFor="acchi-reward-bonus-per-win"
            >
              1勝あたりの付与量 (特典ポイント)
            </label>
            <input
              id="acchi-reward-bonus-per-win"
              type="number"
              min={0}
              max={1000}
              value={settings.perWin}
              onChange={(e) => update('perWin', e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-twilight-amethyst focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              例: 1 に設定すると、1勝につき特典ポイントを 1pt 付与します。
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <label
              className="mb-1 block text-xs font-semibold text-slate-600"
              htmlFor="acchi-reward-bonus-daily-cap"
            >
              1日の上限 (特典ポイント / JST基準)
            </label>
            <input
              id="acchi-reward-bonus-daily-cap"
              type="number"
              min={0}
              max={1000}
              value={settings.dailyCap}
              onChange={(e) => update('dailyCap', e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-twilight-amethyst focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              1日 (JST) にこのユーザーへ付与できる特典ポイントの合計上限です。
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-purple-50 px-4 py-3 text-xs text-purple-800">
          現在の設定: 1勝 = <span className="font-bold">{settings.perWin}pt</span> ／ 1日上限{' '}
          <span className="font-bold">{settings.dailyCap}pt</span>
          {disabled ? (
            <span className="ml-2 font-bold text-rose-600">
              (0 が含まれているため、実質ボーナスは付与されません)
            </span>
          ) : null}
        </div>

        <div className="mt-5 flex items-center justify-end">
          <Button onClick={save} loading={saving} variant="primary">
            設定を保存
          </Button>
        </div>

        <p className="mt-3 text-xs text-slate-400">
          ※ 対象は「あっちむいてPUI」の勝利のみです。ログインボーナス・SNSシェア等は
          引き続き Fan ポイントのみで変更されません。
        </p>
      </CardBody>
    </Card>
  );
}
