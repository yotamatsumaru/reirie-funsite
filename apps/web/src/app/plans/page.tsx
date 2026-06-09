/**
 * /plans
 * 会員プラン紹介ページ
 * - 3 カラム比較 (FREE / STANDARD / PREMIUM)
 * - 月額 / 年額 切替トグル
 * - 詳細比較表 (PLAN_BENEFITS_TABLE)
 * - 各プランの「申し込む」ボタンが Stripe Checkout を起動
 */
import { auth } from '@/auth';
import {
  PLAN_LABELS,
  PLAN_PRICES,
  PLAN_HIGHLIGHTS,
  RECOMMENDED_PLAN,
  groupedPlanBenefits,
} from '@idol/shared';
import { PlanSubscribeSection } from './plan-subscribe-section';

export const dynamic = 'force-dynamic';

export default async function PlansPage() {
  const session = await auth();
  const currentPlan = session?.user?.plan ?? 'FREE';
  const groups = groupedPlanBenefits();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
      <header className="mb-10 text-center">
        <p className="mb-2 text-sm font-semibold tracking-wider text-brand-600">MEMBERSHIP</p>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-4xl">会員プラン</h1>
        <p className="mt-3 text-sm text-slate-600 sm:text-base">
          応援のかたちに合わせて 3 つのプランをご用意しました。
          <br className="hidden sm:block" />
          すべて月単位で解約可能、年額プランは 2 ヶ月分お得です。
        </p>
      </header>

      {/* プラン比較 3 カラム + Stripe Checkout ボタン (Client) */}
      <PlanSubscribeSection
        currentPlan={currentPlan}
        isAuthenticated={!!session?.user?.id}
      />

      {/* 詳細比較表 */}
      <section className="mt-16">
        <h2 className="mb-6 text-xl font-bold text-slate-900 sm:text-2xl">特典一覧</h2>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">特典</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">
                  {PLAN_LABELS.FREE}
                </th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">
                  {PLAN_LABELS.STANDARD}
                  <div className="mt-0.5 text-xs font-normal text-slate-500">
                    ¥{PLAN_PRICES.STANDARD.monthly.toLocaleString()}/月
                  </div>
                </th>
                <th className="bg-brand-50 px-4 py-3 text-center font-semibold text-brand-900">
                  {PLAN_LABELS.PREMIUM}
                  <div className="mt-0.5 text-xs font-normal text-brand-700">
                    ¥{PLAN_PRICES.PREMIUM.monthly.toLocaleString()}/月
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <>
                  <tr key={`g-${g.category}`} className="bg-slate-100/60">
                    <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-slate-600">
                      {g.category}
                    </td>
                  </tr>
                  {g.rows.map((row, i) => (
                    <tr
                      key={`${g.category}-${i}`}
                      className={`border-t border-slate-100 ${row.highlight ? 'bg-amber-50/40' : ''}`}
                    >
                      <td className="px-4 py-2.5 text-slate-700">
                        {row.label}
                        {row.highlight && (
                          <span className="ml-2 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            注目
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-500">{row.free}</td>
                      <td className="px-4 py-2.5 text-center text-slate-800">{row.standard}</td>
                      <td className="bg-brand-50/30 px-4 py-2.5 text-center font-semibold text-brand-900">
                        {row.premium}
                      </td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ハイライト (おすすめポイント) */}
      <section className="mt-16">
        <h2 className="mb-6 text-xl font-bold text-slate-900 sm:text-2xl">おすすめポイント</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {(['FREE', 'STANDARD', 'PREMIUM'] as const).map((p) => {
            const isRec = p === RECOMMENDED_PLAN;
            return (
              <div
                key={p}
                className={`rounded-xl border p-5 ${
                  isRec ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">{PLAN_LABELS[p]}</h3>
                  {isRec && (
                    <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      おすすめ
                    </span>
                  )}
                </div>
                <ul className="space-y-1.5 text-sm text-slate-700">
                  {PLAN_HIGHLIGHTS[p].map((h, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-500" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* 注意事項 */}
      <section className="mt-16 rounded-xl border border-slate-200 bg-slate-50 p-6 text-xs leading-relaxed text-slate-600 sm:text-sm">
        <h3 className="mb-2 font-semibold text-slate-800">ご利用にあたって</h3>
        <ul className="space-y-1">
          <li>• 月額プランは毎月、年額プランは毎年自動更新されます。</li>
          <li>• いつでもマイページから解約できます。解約後は当該課金期間の終了まで利用可能です。</li>
          <li>• 表示価格は税込みです。決済は Stripe を利用しています。</li>
          <li>• プラン変更時は次回更新時から適用されます (即時変更は差額調整あり)。</li>
          <li>• ゲーム内のアイテム・章購入は別途課金となります (景品表示法に基づき確定報酬制を採用)。</li>
        </ul>
      </section>
    </main>
  );
}
