import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCapabilityPage } from '@/auth';
import { isMediaConvertConfigured } from '@/lib/mediaconvert';
import { UploadVideoForm } from './upload-form';

export const metadata: Metadata = { title: '動画アップロード' };
export const dynamic = 'force-dynamic';

export default async function NewVideoPage() {
  await requireCapabilityPage('CONTENT');
  const mediaConvertReady = isMediaConvertConfigured();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/admin/videos" className="text-sm text-slate-500 hover:text-slate-700">
          ← 動画管理へ戻る
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-800 sm:text-2xl">動画アップロード</h1>
        <p className="mt-1 text-sm text-slate-500">
          動画ファイルを S3 にアップロードし、MediaConvert で HLS（TS）にエンコードします。
          エンコード完了後にファンクラブ内で再生できるようになります。
        </p>
      </div>

      {!mediaConvertReady && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          MediaConvert が未設定です（<code>S3_VIDEO_BUCKET</code> /{' '}
          <code>MEDIACONVERT_ROLE_ARN</code>）。アップロードはできますが、エンコードは環境設定後に
          実行してください。
        </div>
      )}

      <UploadVideoForm />
    </div>
  );
}
