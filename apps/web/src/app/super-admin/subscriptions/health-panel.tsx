/**
 * プラン反映の不整合パネル (Server Component)
 *
 * 「決済は成功しているのにプランが反映されていない会員」を運営が
 * 会員からの申告を待たずに発見するための一覧。
 *
 * 実際の復旧は各会員の詳細画面（サブスクリプション操作 → sync / grant）で行う。
 * ここでは「誰が困っているか」を可視化することに専念する。
 */
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { buildSubscriptionHealthReport } from '@/lib/subscription-health';

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export async function SubscriptionHealthPanel() {
  const report = await buildSubscriptionHealthReport();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {report.totalIssues > 0 ? (
              <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
            )}
            <h2 className="text-lg font-semibold">プラン反映の不整合チェック</h2>
          </div>
          {report.totalIssues > 0 ? (
            <Badge tone="danger">要対応 {report.totalIssues} 件</Badge>
          ) : (
            <Badge tone="success">問題なし</Badge>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-6">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          お支払いは完了しているのにプランが反映されていない会員を検出します。
          該当者がいる場合、その会員は<strong>無料プラン扱いのまま</strong>になっており、
          有料コンテンツを利用できていません。会員詳細の「サブスクリプション操作」から
          <strong>同期(sync)</strong>を実行すると復旧できます。
        </p>

        {/* --- ① 決済済みなのにプラン未反映 --- */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            決済済みなのにプランが反映されていない会員
          </h3>
          {report.mismatched.length === 0 ? (
            <p className="text-sm text-gray-500">該当なし</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="px-2 py-2">会員</th>
                    <th className="px-2 py-2">会員番号</th>
                    <th className="px-2 py-2">最終決済</th>
                    <th className="px-2 py-2">経過</th>
                    <th className="px-2 py-2">状況</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {report.mismatched.map((u) => (
                    <tr
                      key={u.userId}
                      className="border-b last:border-0 align-top"
                    >
                      <td className="px-2 py-2">
                        <div className="font-medium">{u.displayName ?? '—'}</div>
                        <div className="text-xs text-gray-500">{u.email}</div>
                      </td>
                      <td className="px-2 py-2 text-xs">{u.memberNumber ?? '—'}</td>
                      <td className="px-2 py-2 text-xs">{formatDate(u.lastPaymentAt)}</td>
                      <td className="px-2 py-2">
                        {/* 待たせている日数が長いほど強調する */}
                        <Badge tone={u.daysSincePaid >= 3 ? 'danger' : 'warning'}>
                          {u.daysSincePaid}日
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
                          {u.mismatches.map((m) => (
                            <li key={m.kind}>{m.message}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <Link
                          href={`/super-admin/users/${u.userId}`}
                          className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
                        >
                          対応する
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/*
          二重契約はこのページ上部の既存バナーで表示済みのため、
          ここでは重複表示しない（同じ情報が2箇所にあると見落としを招くため）。
        */}

        {/* --- ② 会員に紐付かなかった Webhook --- */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            会員に紐付けられなかった決済通知
          </h3>
          <p className="mb-2 text-xs text-gray-500">
            Stripe 側では決済されたものの、どの会員のものか特定できずに処理が
            見送られた通知です。決済時に登録と異なるメールアドレスが使われた場合などに発生します。
          </p>
          {report.orphanEvents.length === 0 ? (
            <p className="text-sm text-gray-500">該当なし</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="px-2 py-2">受信日時</th>
                    <th className="px-2 py-2">種別</th>
                    <th className="px-2 py-2">Stripe 顧客 ID</th>
                  </tr>
                </thead>
                <tbody>
                  {report.orphanEvents.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="px-2 py-2 text-xs">{formatDate(e.processedAt)}</td>
                      <td className="px-2 py-2 text-xs">{e.type}</td>
                      <td className="px-2 py-2 font-mono text-xs">
                        {e.stripeCustomerId ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </CardBody>
    </Card>
  );
}
