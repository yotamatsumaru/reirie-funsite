import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCapabilityPage } from '@/auth';
import { mediaConvertDiagnostics } from '@/lib/mediaconvert';
import { UploadVideoForm } from './upload-form';
import { EncodeConfigNotice } from './encode-config-notice';

export const metadata: Metadata = { title: '動画アップロード' };
export const dynamic = 'force-dynamic';

export default async function NewVideoPage() {
  await requireCapabilityPage('CONTENT');
  const diag = mediaConvertDiagnostics();

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

      <EncodeConfigNotice
        ready={diag.ready}
        missingRequired={diag.missingRequired}
        missingPlayback={diag.missingPlayback}
        missingAutomation={diag.missingAutomation}
        resolved={diag.resolved}
      />

      <UploadVideoForm encodeReady={diag.ready} />
    </div>
  );
}
