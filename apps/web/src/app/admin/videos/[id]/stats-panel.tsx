/**
 * 動画の視聴データ表示パネル。
 *
 * Server Component にしている（'use client' を付けない）。
 * 集計値を表示するだけで操作が無いため、クライアントへ JS を
 * 送る必要がなく、ページの初期表示も速い。
 *
 * ## 表示する指標を選んだ理由
 *
 * 「どれくらい再生されたか」を判断するには、回数だけでは足りない。
 *   - 再生開始回数だけ多い → サムネで釣れているが中身が刺さっていない
 *   - 平均視聴率が高い     → 尺と内容が合っている
 *   - 完視聴率が高い       → 最後まで見る価値があると思われている
 * この 3 つを並べることで判断できるようにしている。
 *
 * ## ダークモードへの配慮
 *
 * 管理画面は `[data-admin-theme='dark']` 配下で Tailwind の
 * カラー変数そのものが差し替わるため、`dark:` クラスは不要。
 * ただし色だけで強調すると（例: 白背景 + 赤文字）両方の変数が
 * 反転してコントラストを失うので、太字・枠線・背景の
 * 組み合わせで階層を作っている。
 */
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import {
  formatMs,
  formatRatio,
  retentionBars,
  type VideoStats,
} from '@/lib/video-analytics';

export function VideoStatsPanel({
  stats,
  dropOff,
  durationSeconds,
}: {
  stats: VideoStats;
  dropOff: number[] | null;
  durationSeconds: number | null;
}) {
  const bars = dropOff ? retentionBars(dropOff) : null;
  // 維持率グラフは計測済みの視聴が無いと形にならないので出さない。
  const hasRetention = Boolean(bars && (bars[0]?.viewers ?? 0) > 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">視聴データ</h2>
          {durationSeconds ? (
            <p className="text-xs text-slate-400">尺 {formatMs(durationSeconds * 1000)} 基準</p>
          ) : (
            // 尺が取れていないと視聴率・完視聴率・維持率が全て出せない。
            // 「バグで空欄」と誤解されないよう理由を明示する。
            <p className="text-xs text-slate-400">
              尺が不明なため視聴率は算出できません
            </p>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Metric
            label="再生開始"
            value={`${stats.playStarts.toLocaleString('ja-JP')} 回`}
            hint="再生ボタンが押された回数（同じ人の再読み込みも含む）"
          />
          <Metric
            label="視聴した人数"
            value={`${stats.uniqueViewers.toLocaleString('ja-JP')} 人`}
            hint="重複を除いた実人数"
          />
          <Metric
            label="合計視聴時間"
            value={stats.totalWatchedLabel}
            hint="全員が実際に再生した時間の合計"
          />
          <Metric
            label="平均視聴時間"
            value={stats.avgWatchedLabel}
            hint="1 回の視聴で実際に再生された時間"
          />
          <Metric
            label="平均視聴率"
            value={formatRatio(stats.avgWatchRatio)}
            hint="平均視聴時間 ÷ 動画の尺"
          />
          <Metric
            label="完視聴率"
            value={formatRatio(stats.completionRate)}
            hint="95% 以上まで再生された割合"
          />
        </div>

        {/*
          計測前に記録された視聴があると、平均系の分母が
          「再生開始回数」と一致しない。数字が合わないと運営が
          不具合を疑うので、差分の理由を明示する。
        */}
        {stats.unmeasuredCount > 0 && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            うち <span className="font-bold text-slate-800">{stats.unmeasuredCount} 回</span>{' '}
            は視聴時間の計測を始める前の記録のため、時間・視聴率の集計には含めていません
            （集計対象: {stats.measuredCount} 回）。
          </p>
        )}

        {hasRetention && bars && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-700">視聴の離脱ポイント</h3>
              <p className="text-xs text-slate-400">
                各区間まで到達した人数（計測対象 {stats.measuredCount} 回）
              </p>
            </div>
            {/*
              棒グラフはライブラリを使わず div の幅で表現する。
              管理画面にグラフライブラリを 1 つ入れるだけで
              バンドルが数十 KB 増えるが、ここで必要なのは
              「どこで減ったか」が読み取れる程度の粒度のため。
            */}
            <ul className="space-y-1">
              {bars.map((b) => (
                <li key={b.label} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-right text-slate-500">{b.label}</span>
                  <span className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                    <span
                      className="block h-full rounded bg-brand-500"
                      style={{ width: `${Math.round(b.ratio * 100)}%` }}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right tabular-nums text-slate-600">
                    {b.viewers} 人
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-400">
              右に行くほど棒が短くなるのが通常です。特定の区間で急に短くなる場合、
              そこが離脱の起きやすい箇所です。
            </p>
          </div>
        )}

        {!hasRetention && (
          <p className="text-xs text-slate-500">
            {stats.playStarts === 0
              ? 'まだ再生されていません。'
              : '視聴時間の計測データがまだありません。計測は再生開始から数十秒後に記録されます。'}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * 指標 1 つ分の表示。
 *
 * hint を必須にしているのは、指標名だけでは意味が確定しないため。
 * 特に「再生開始」と「視聴した人数」の違いは説明が無いと
 * 数字が合わないバグに見える。
 */
function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{hint}</p>
    </div>
  );
}
