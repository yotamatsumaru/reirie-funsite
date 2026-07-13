import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCapabilityPage } from '@/auth';
import { ContentForm } from '../content-form';

export const metadata: Metadata = { title: 'コンテンツ新規作成' };
export const dynamic = 'force-dynamic';

export default async function NewContentPage() {
  await requireCapabilityPage('CONTENT');

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/admin/contents"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← コンテンツ管理へ戻る
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-800 sm:text-2xl">
          コンテンツ新規作成
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          ブログ記事やギャラリーを作成します。下書き保存もできます。
        </p>
      </div>

      <ContentForm mode="create" />
    </div>
  );
}
