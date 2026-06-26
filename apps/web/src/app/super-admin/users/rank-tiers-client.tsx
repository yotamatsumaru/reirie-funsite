'use client';

/**
 * 会員ランクの昇格条件 (しきい値) 編集 UI (SUPER_ADMIN 専用)。
 *
 * 各ランク (BRONZE は固定) について「必要ログイン日数」「必要買い物数」を編集し、
 * PATCH /api/super-admin/member-ranks で永続化する。
 * 条件はファンには非公開 (この画面は管理者のみ)。
 */
import { useState } from 'react';
import {
  MEMBER_RANKS,
  MEMBER_RANK_LABELS,
  type MemberRank,
  type MemberRankTiers,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RankBadge } from '@/components/membership/RankBadge';
import { toast } from '@/stores/ui-store';

export function RankTiersClient({ initial }: { initial: MemberRankTiers }) {
  const [tiers, setTiers] = useState<MemberRankTiers>(initial);
  const [saving, setSaving] = useState(false);

  function update(
    rank: MemberRank,
    field: 'minLoginDays' | 'minPurchases',
    value: number,
  ) {
    setTiers((t) => ({
      ...t,
      [rank]: { ...t[rank], [field]: Math.max(0, Math.floor(value || 0)) },
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/super-admin/member-ranks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tiers),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '保存に失敗しました');
      }
      setTiers(json.tiers as MemberRankTiers);
      toast.success('会員ランクの昇格条件を保存しました');
    } catch (e) {
      toast.error((e as Error).message, '保存エラー');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-800">会員ランク 昇格条件（非公開）</h2>
        <p className="mt-1 text-xs text-slate-500">
          各ランクは「ログイン日数 ≧ X <strong>かつ</strong> 買い物数 ≧ Y」を満たすと昇格します。
          条件を満たす最上位ランクが自動適用されます。
          <span className="ml-1 text-rose-500">この条件はファンには公開されません。</span>
        </p>
      </CardHeader>
      <CardBody>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">ランク</th>
                <th className="px-4 py-3 text-right">必要ログイン日数</th>
                <th className="px-4 py-3 text-right">必要買い物数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {MEMBER_RANKS.map((rank) => {
                const isBronze = rank === 'BRONZE';
                const cond = tiers[rank];
                return (
                  <tr key={rank} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <RankBadge rank={rank} size="sm" />
                      {isBronze ? (
                        <span className="ml-2 text-xs text-slate-400">初期ランク</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        min={0}
                        value={cond.minLoginDays}
                        disabled={isBronze}
                        onChange={(e) => update(rank, 'minLoginDays', Number(e.target.value))}
                        aria-label={`${MEMBER_RANK_LABELS[rank]} 必要ログイン日数`}
                        className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-right text-sm focus:border-rose-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                      />
                      <span className="ml-1 text-xs text-slate-400">日</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        min={0}
                        value={cond.minPurchases}
                        disabled={isBronze}
                        onChange={(e) => update(rank, 'minPurchases', Number(e.target.value))}
                        aria-label={`${MEMBER_RANK_LABELS[rank]} 必要買い物数`}
                        className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-right text-sm focus:border-rose-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                      />
                      <span className="ml-1 text-xs text-slate-400">回</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <Button onClick={save} loading={saving} variant="primary">
            条件を保存
          </Button>
        </div>

        <p className="mt-3 text-xs text-slate-400">
          ※ ログイン日数 = ログインボーナス受領日数 / 買い物数 = 入金完了した注文件数。
        </p>
      </CardBody>
    </Card>
  );
}
