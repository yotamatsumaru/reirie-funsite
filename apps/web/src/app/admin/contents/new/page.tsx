/**
 * ブログ / ギャラリーの新規作成。
 *
 * ## `?type=` を受け取る理由
 *
 * 一覧をブログとギャラリーに分けたため、
 * どちらの一覧から来たかで初期の種別を合わせる必要がある。
 * これが無いと「ギャラリー管理から作ったのにブログとして開き、
 * 写真の登録欄が出てこない」という状態になる。
 *
 * 種別はフォーム内でも変更できるので、ここでの指定は初期値にすぎない。
 * 不正な値が来たときはブログ (既定) に倒す。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCapabilityPage } from '@/auth';
import { ContentForm, type ContentType } from '../content-form';

export const metadata: Metadata = { title: '新規作成' };
export const dynamic = 'force-dynamic';

export default async function NewContentPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireCapabilityPage('CONTENT');

  const { type } = await searchParams;
  // 不正な値は既定 (ブログ) に倒す。
  const initialType: ContentType = type === 'GALLERY' ? 'GALLERY' : 'BLOG';
  const isGallery = initialType === 'GALLERY';

  // 戻り先も来た一覧に合わせる。常に /admin/contents に戻すと
  // ギャラリー管理から来た人がブログ一覧に飛ばされる。
  const backHref = isGallery ? '/admin/galleries' : '/admin/contents';
  const backLabel = isGallery ? '← ギャラリー管理へ戻る' : '← ブログ管理へ戻る';

  return (
    <div className="space-y-5">
      <div>
        <Link href={backHref} className="text-sm text-slate-500 hover:text-slate-700">
          {backLabel}
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-800 sm:text-2xl">
          {isGallery ? 'ギャラリーを作る' : '記事を書く'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isGallery
            ? 'ライブ写真などをまとめて公開します。下書き保存もできます。'
            : 'ブログ記事を作成します。下書き保存・公開予約もできます。'}
        </p>
      </div>

      <ContentForm mode="create" initialType={initialType} />
    </div>
  );
}
