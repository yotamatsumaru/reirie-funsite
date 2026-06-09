/**
 * /maintenance — メンテナンス中ページ
 *
 * super-admin 設定で maintenance.enabled が true のとき、すべての通常ページから
 * このページにリダイレクトされる (super-admin と /api/auth は除外)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'メンテナンス中',
  description: 'システムメンテナンス中です',
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 px-4 py-12">
      <div className="max-w-lg rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm sm:p-12">
        <p className="text-6xl">🔧</p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900 sm:text-3xl">
          ただいまメンテナンス中です
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
          より良いサービスをお届けするため、システムメンテナンスを実施しております。
          <br />
          ご不便をおかけいたしますが、しばらくお待ちください。
        </p>

        <div className="mt-8 rounded-lg bg-slate-50 p-4 text-left text-xs text-slate-600 sm:text-sm">
          <p className="font-semibold text-slate-800">📌 お知らせ</p>
          <ul className="mt-2 space-y-1 list-disc pl-5">
            <li>メンテナンス中は一部の機能がご利用いただけません</li>
            <li>復旧時刻は公式X(旧Twitter)でお知らせします</li>
            <li>すでに購入済みのコンテンツに影響はありません</li>
          </ul>
        </div>

        <p className="mt-6 text-xs text-slate-400">
          IDOL FAN SITE
        </p>

        <div className="mt-2 flex items-center justify-center gap-3 text-xs">
          <Link
            href="/"
            className="text-brand-600 hover:underline"
          >
            再読み込み
          </Link>
          <span className="text-slate-300">|</span>
          <Link
            href="/super-admin/settings"
            className="text-slate-500 hover:underline"
          >
            管理者ログイン
          </Link>
        </div>
      </div>
    </div>
  );
}
