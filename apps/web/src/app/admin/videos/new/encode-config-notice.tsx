/**
 * エンコード / 配信設定の状況を管理者に伝える通知ブロック。
 *
 * 「MediaConvert が未設定です」だけでは何を直せばよいか分からないため、
 *   - エンコード実行に必須の不足項目
 *   - 再生 (CloudFront 署名) に必須の不足項目
 *   - 完了時の自動 READY 化に必要な項目
 * を分けて、環境変数名と設定手順つきで表示する。
 */
import type { EncodeQuality } from '@/lib/mediaconvert';

type Resolved = {
  sourceBucket: string;
  outputBucket: string;
  outputKeyPrefix: string;
  region: string;
  qualities: EncodeQuality[];
  segmentSeconds: number;
  usingSingleBucket: boolean;
};

export function EncodeConfigNotice({
  ready,
  missingRequired,
  missingPlayback,
  missingAutomation,
  resolved,
}: {
  ready: boolean;
  missingRequired: string[];
  missingPlayback: string[];
  missingAutomation: string[];
  resolved: Resolved;
}) {
  const allGood =
    ready && missingPlayback.length === 0 && missingAutomation.length === 0;

  return (
    <div className="space-y-3">
      {/* --- エンコード実行の可否 (最重要) --- */}
      {!ready && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <p className="font-semibold">エンコードを実行できません</p>
          <p className="mt-1">
            以下の環境変数が未設定です。アップロードは可能ですが、エンコードは設定後に
            動画詳細ページから実行してください。
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {missingRequired.map((k) => (
              <li key={k}>
                <code className="rounded bg-rose-100 px-1 py-0.5 text-xs">{k}</code>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-rose-600">
            設定手順は <code>docs/VIDEO_ENCODING.md</code> を参照してください。
          </p>
        </div>
      )}

      {/* --- 再生 (CloudFront 署名) の可否 --- */}
      {ready && missingPlayback.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <p className="font-semibold">エンコードは可能ですが、再生できません</p>
          <p className="mt-1">
            CloudFront 署名付き URL の設定が未完了のため、エンコード後もファンクラブ内で
            再生できません（CloudFront が 403 を返します）。
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {missingPlayback.map((k) => (
              <li key={k}>
                <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">{k}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- 完了通知の自動化 --- */}
      {ready && missingAutomation.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="font-semibold text-slate-700">
            エンコード完了の自動反映が無効です
          </p>
          <p className="mt-1">
            <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">
              {missingAutomation.join(' / ')}
            </code>{' '}
            が未設定のため、完了後に自動で公開状態になりません。動画詳細ページの
            「手動で公開（READY化）」で公開してください。
          </p>
        </div>
      )}

      {allGood && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          エンコード・配信の設定は完了しています。アップロード後、自動でエンコードが開始されます。
        </div>
      )}

      {/* --- 現在の設定内容 (常時表示) --- */}
      <details className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">
          現在のエンコード設定
        </summary>
        <dl className="mt-3 grid grid-cols-1 gap-y-2 sm:grid-cols-2">
          <ConfigRow label="リージョン" value={resolved.region} />
          <ConfigRow label="出力画質" value={resolved.qualities.join(' / ') || '—'} />
          <ConfigRow
            label="セグメント長"
            value={`${resolved.segmentSeconds} 秒`}
          />
          <ConfigRow
            label="出力プレフィックス"
            value={`${resolved.outputKeyPrefix}/<動画ID>/index.m3u8`}
          />
          <ConfigRow
            label="アップロード先バケット"
            value={resolved.sourceBucket || '未設定'}
          />
          <ConfigRow
            label="HLS 出力先バケット"
            value={resolved.outputBucket || '未設定'}
          />
        </dl>
        {resolved.usingSingleBucket && resolved.outputBucket && (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <code>S3_MEDIA_OUTPUT_BUCKET</code> が未設定のため、HLS
            をアップロード先と同じバケットに出力します。CloudFront
            動画ディストリビューションのオリジンがこのバケットでない場合は再生できません。
          </p>
        )}
      </details>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="break-all font-mono text-xs text-slate-700">{value}</dd>
    </div>
  );
}
