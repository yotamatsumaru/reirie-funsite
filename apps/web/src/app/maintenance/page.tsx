/**
 * /maintenance — メンテナンス中ページ
 *
 * super-admin 設定で site.maintenance が enabled=true のとき、middleware が
 * SUPER_ADMIN 以外のすべての訪問者をこのページへリダイレクトする
 * (SUPER_ADMIN・/api/auth・/signin・静的アセットは除外)。
 *
 * 管理者が任意メッセージを設定していればそれを、無ければ既定文言を表示する。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Sparkles, Info } from 'lucide-react';
import { DEFAULT_MAINTENANCE_MESSAGE, SITE_TITLE_DEFAULT, SITE_DESCRIPTION } from '@idol/shared';
import { getMaintenanceSetting } from '@/lib/app-setting';
import { isMaintenanceModeAsync } from '@/lib/maintenance-flag';
import { MaintenanceWatcher } from './maintenance-watcher';

export const metadata: Metadata = {
  // 【重要 / SEO】メンテナンス中はトップページ等が /maintenance にリダイレクトされるため、
  // ここで独自タイトル (例: 「メンテナンス中」) を出すと、その間だけサイトの
  // <title> やSEOタイトルが変わってしまう。これを防ぐため、トップページと同じ
  // 固定タイトル・説明を absolute で指定し、テンプレートも適用させない。
  title: { absolute: SITE_TITLE_DEFAULT },
  description: SITE_DESCRIPTION,
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function MaintenancePage() {
  // メンテナンスが既に解除されているのにこのページを開いた (リロード / 直リンク /
  // 終了後の再アクセス) 場合は、メンテ画面を見せずにトップへ戻す。
  // proxy.ts は /maintenance を常に通すため、ここで明示的に判定する。
  if (!(await isMaintenanceModeAsync())) {
    redirect('/');
  }

  const setting = await getMaintenanceSetting();
  const message = setting.message.trim() || DEFAULT_MAINTENANCE_MESSAGE;

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-100 px-4 py-12">
      <div className="max-w-lg rounded-2xl border border-brand-200 bg-white p-8 text-center shadow-sm sm:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-brand-600">
          <Sparkles className="h-8 w-8" strokeWidth={1.75} />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-slate-900 sm:text-3xl">
          ただいまメンテナンス中です
        </h1>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600 sm:text-base">
          {message}
        </p>

        <div className="mt-8 rounded-lg border border-brand-100 bg-brand-50 p-4 text-left text-xs text-slate-600 sm:text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-brand-800">
            <Info className="h-4 w-4" strokeWidth={2} />
            お知らせ
          </p>
          <ul className="mt-2 space-y-1 list-disc pl-5">
            <li>メンテナンス中は一部の機能がご利用いただけません</li>
            <li>復旧時刻は公式X(旧Twitter)でお知らせします</li>
            <li>すでに購入済みのコンテンツに影響はありません</li>
          </ul>
        </div>

        <p className="mt-6 text-xs font-black uppercase tracking-wide text-slate-400">
          IDOL FAN SITE
        </p>

        <div className="mt-2 flex items-center justify-center gap-3 text-xs">
          <Link href="/" prefetch={false} className="text-brand-600 hover:underline">
            トップへ戻る
          </Link>
          <span className="text-slate-300">|</span>
          <Link href="/signin" className="text-slate-500 hover:underline">
            管理者ログイン
          </Link>
        </div>

        {/* メンテナンス解除を検知したら自動でトップへ遷移する */}
        <MaintenanceWatcher />
      </div>
    </div>
  );
}
