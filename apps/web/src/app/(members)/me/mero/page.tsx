/**
 * /me/mero — 自分の Mero (Pui の上位ポイント) 残高と履歴
 *
 * 【非公開中】site.sectionVisibility.meroVisible が false の間は
 * 一般会員には 404 (機能の存在自体を隠す)。管理者はプレビューでき、
 * 画面の先頭に「非公開中」バナーを出す。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  MERO_REASON_LABELS,
  formatJstDateTime,
  type MeroReasonLiteral,
} from '@idol/shared';
import { auth } from '@/auth';
import { resolveMeroVisibility } from '@/lib/mero-visibility';
import { getMeroSummary } from '@/lib/mero';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { MeroPreviewBanner } from '@/components/mero/MeroPreviewBanner';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // 非公開中は一般会員に «Mero» という名前すら見せない (タブ名からも漏らさない)
  const { canView } = await resolveMeroVisibility();
  return canView
    ? { title: 'Mero', robots: { index: false, follow: false } }
    : { title: 'ページが見つかりません', robots: { index: false, follow: false } };
}

export default async function MeroPage() {
  // 公開判定を先に行う。非公開中の一般会員はログインしていても 404。
  const { canView, isPreview } = await resolveMeroVisibility();
  if (!canView) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=%2Fme%2Fmero');

  const { balance, transactions } = await getMeroSummary(session.user.id, 50);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      {isPreview && <MeroPreviewBanner />}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Mero</h1>
          <p className="mt-1 text-sm text-slate-500">Mero の残高と履歴</p>
        </div>
        <Link href="/me/points" className="text-sm text-brand-600 hover:underline">
          Pui 履歴へ
        </Link>
      </header>

      <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-white">
        <CardBody>
          <p className="text-sm text-violet-700">Mero</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
            {balance.toLocaleString()}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            ライブ特典やオンライン物販の特典でもらえる、Pui の上位ポイントです。
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">履歴</h2>
        </CardHeader>
        <CardBody className="p-0">
          {transactions.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">まだ履歴はありません。</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {transactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {MERO_REASON_LABELS[t.reason as MeroReasonLiteral] ?? t.reason}
                    </p>
                    {t.note && <p className="truncate text-xs text-slate-500">{t.note}</p>}
                    <p className="text-[11px] text-slate-400">{formatJstDateTime(t.createdAt)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={`text-sm font-bold tabular-nums ${
                        t.amount > 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {t.amount > 0 ? '+' : ''}
                      {t.amount.toLocaleString()}
                    </p>
                    <p className="text-[11px] tabular-nums text-slate-400">
                      残高 {t.balance.toLocaleString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
