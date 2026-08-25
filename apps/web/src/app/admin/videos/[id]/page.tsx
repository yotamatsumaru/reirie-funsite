import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { requireCapabilityPage } from '@/auth';
import { formatJstDateTime } from '@idol/shared';
import { resolveThumbnailUrlAsync } from '@/lib/video-delivery';
import { VideoAdminActions } from './actions';
import { VideoEditForm } from './edit-form';
import { VideoDeletePanel } from './delete-panel';

export const metadata: Metadata = { title: '動画詳細' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  UPLOADING: 'アップロード済み（未エンコード）',
  PROCESSING: 'エンコード中',
  READY: '公開可能（READY）',
  FAILED: '失敗',
};

/** 生の enum 値だと運用者に伝わりにくいので日本語に直す */
const ACCESS_LABEL: Record<string, string> = {
  PUBLIC: '全員',
  MEMBERS: '会員限定',
  PREMIUM: 'プレミアム限定',
};

function tone(status: string): 'success' | 'danger' | 'info' | 'warning' {
  if (status === 'READY') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'PROCESSING') return 'warning';
  return 'info';
}

export default async function AdminVideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapabilityPage('CONTENT');
  const { id } = await params;

  const video = await prisma.video.findUnique({
    where: { id },
    include: { _count: { select: { viewLogs: true } } },
  });
  if (!video) notFound();

  // DB の生の値は S3 キーのこともあるため、プレビュー表示用に解決した URL も渡す。
  // 解決できない場合 (配信設定が無い等) は null になり「未設定」表示にフォールバックする。
  const thumbnailPreviewUrl = await resolveThumbnailUrlAsync(video.thumbnailUrl);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/admin/videos" className="text-sm text-slate-500 hover:text-slate-700">
          ← 動画管理へ戻る
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">{video.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {/* 公開スイッチとエンコード状態は別軸なので並べて表示する */}
            <Badge tone={video.isPublished ? 'success' : 'gray'}>
              {video.isPublished ? '公開中' : '非公開'}
            </Badge>
            <Badge tone={tone(video.status)}>{STATUS_LABEL[video.status] ?? video.status}</Badge>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">基本情報</h2>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
            <Field label="公開範囲" value={ACCESS_LABEL[video.accessLevel] ?? video.accessLevel} />
            <Field
              label="尺"
              value={video.durationSeconds ? `${Math.floor(video.durationSeconds / 60)}分${video.durationSeconds % 60}秒` : '—'}
            />
            <Field label="視聴回数" value={`${video._count.viewLogs} 回`} />
            {/*
              公開開始日時が未来のときは「予約」と明示する。
              日時だけを出すと、公開済みなのか待機中なのかが読み取れず
              「公開したのに会員側に出ない」という問い合わせにつながる。
            */}
            <Field
              label="公開開始日時"
              value={
                video.publishedAt
                  ? `${formatJstDateTime(video.publishedAt)}${
                      video.publishedAt > new Date() ? '（公開予約中）' : ''
                    }`
                  : '未設定'
              }
            />
            <Field
              label="配信期限"
              value={video.expiresAt ? formatJstDateTime(video.expiresAt) : 'なし'}
            />
            <Field label="作成" value={formatJstDateTime(video.createdAt)} />
            <Field label="最終更新" value={formatJstDateTime(video.updatedAt)} />
          </dl>
        </CardBody>
      </Card>

      {/*
        タイトル / 説明文はアップロード時にファイル名から仮の値が入るため、
        後から直せるようにしておく（直せないとファイル名が会員に見えてしまう）。
        サムネイルも同様で、エンコードが自動生成したコマが不適切なときや
        そもそも生成されなかったときに差し替えられる必要がある。
      */}
      <VideoEditForm
        videoId={video.id}
        title={video.title}
        description={video.description}
        accessLevel={video.accessLevel}
        publishedAt={video.publishedAt ? video.publishedAt.toISOString() : null}
        expiresAt={video.expiresAt ? video.expiresAt.toISOString() : null}
        thumbnailUrl={video.thumbnailUrl}
        thumbnailPreviewUrl={thumbnailPreviewUrl}
      />

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">エンコード / ストレージ</h2>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-y-2 text-sm">
            <Field label="ソースキー (S3)" value={video.s3SourceKey} mono />
            <Field label="HLSキー (S3)" value={video.s3HlsKey ?? '未生成'} mono />
            <Field label="MediaConvert ジョブ" value={video.mediaConvertJob ?? '—'} mono />
          </dl>
        </CardBody>
      </Card>

      <VideoAdminActions
        videoId={video.id}
        status={video.status}
        hasHls={Boolean(video.s3HlsKey)}
        isPublished={video.isPublished}
      />

      {/*
        削除は取り消せないので、通常操作から離してページ最下部に置く。
        （上に置くと編集のたびに視界に入り、誤操作の確率が上がる）
      */}
      <VideoDeletePanel
        videoId={video.id}
        title={video.title}
        viewCount={video._count.viewLogs}
      />
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className={`text-slate-700 ${mono ? 'break-all font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
