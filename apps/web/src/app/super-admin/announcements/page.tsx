/**
 * /super-admin/announcements — お知らせ配信管理
 *
 * - 一覧 (DRAFT / PUBLISHED, audience 別)
 * - 新規作成フォーム
 * - 行内アクション: プレビュー / 編集 (インライン展開) / 公開切替 / 削除
 * - 各お知らせの公開 URL コピー (外部サイトへの掲載・アクセス元制限の登録用)
 *
 * STAFF は閲覧のみなので、書き込み系のボタンは canEdit で出し分ける
 * (API 側も requireSuperAdmin で二重に防いでいる)。
 * URL のコピーは閲覧操作なので STAFF にも出す。
 */
import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { listAnnouncements } from '@/lib/announcements';
import { requireSuperAdminView } from '@/auth';
import { env } from '@/lib/env';
import { AnnouncementForm } from './announcement-form';
import { AnnouncementListItem } from './announcement-list-item';
import {
  AUDIENCE_SHORT_LABELS,
  AUDIENCE_TONES,
} from '@/lib/announcement-audience';
import { AnnouncementLinkCopy } from './announcement-link-copy';
import { ExternalLinkGuide } from './external-link-guide';
import { SuperAdminWriteGate } from '@/components/admin/SuperAdminReadOnly';

export const metadata: Metadata = { title: 'お知らせ配信 | Super Admin' };
export const dynamic = 'force-dynamic';

// 配信対象のラベル / 色は lib/announcement-audience.ts に集約してある。
// (以前はこのファイル内で定義していたため、公開プージ側とラベルがずれていた)

type EmailStatus = 'NOT_REQUESTED' | 'PENDING' | 'SENDING' | 'COMPLETED' | 'FAILED';

const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  NOT_REQUESTED: 'メール送信なし',
  PENDING: '送信待ち',
  SENDING: '送信中',
  COMPLETED: '送信完了',
  FAILED: '送信失敗',
};

const EMAIL_STATUS_TONES: Record<
  EmailStatus,
  'gray' | 'brand' | 'success' | 'warning' | 'danger' | 'info'
> = {
  NOT_REQUESTED: 'gray',
  PENDING: 'warning',
  SENDING: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
};

function formatDateTime(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export default async function SuperAdminAnnouncementsPage() {
  const session = await requireSuperAdminView();

  // STAFF は閲覧のみ (書き込み API は requireSuperAdmin で弾かれる)。
  // 押しても 403 になるボタンを出さないよう、ここで出し分ける。
  const canEdit = session.user.role === 'SUPER_ADMIN';

  const all = await listAnnouncements();
  // お知らせの公開 URL を組み立てるためのベース (末尾スラッシュは落とす)
  const baseUrl = env.appBaseUrl.replace(/\/$/, '');
  const published = all.filter((a) => a.status === 'PUBLISHED');
  const drafts = all.filter((a) => a.status === 'DRAFT');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">お知らせ配信</h1>
          <p className="mt-1 text-sm text-slate-600">
            会員向けのお知らせを作成・配信します。
          </p>
        </div>
      </div>

      {/* 外部チケットサイト (LivePocket 等) 向けの設定ガイド */}
      <ExternalLinkGuide origin={baseUrl} />

      {/* KPI */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">公開中</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {published.length}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">下書き</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {drafts.length}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">直近公開</p>
            <p className="mt-2 text-sm font-bold text-slate-900">
              {published[0]
                ? formatDateTime(published[0].publishedAt)
                : 'まだありません'}
            </p>
          </CardBody>
        </Card>
      </div>

      {/* 新規作成フォーム */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">
            ✏️ 新規お知らせを作成
          </h2>
        </CardHeader>
        <CardBody>
          <SuperAdminWriteGate label="お知らせの作成はスーパー管理者のみ実行できます">
            <AnnouncementForm />
          </SuperAdminWriteGate>
        </CardBody>
      </Card>

      {/* 一覧 */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">
            お知らせ一覧
            <span className="ml-2 text-sm font-normal text-slate-500">
              ({all.length} 件)
            </span>
          </h2>
        </CardHeader>
        <CardBody className="p-0">
          {all.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              お知らせはまだありません
            </p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {all.map((a) => (
                <li key={a.id} className="px-4 py-4">
                  <AnnouncementListItem
                    id={a.id}
                    status={a.status}
                    emailStatus={a.emailStatus}
                    canEdit={canEdit}
                    initial={{
                      title: a.title,
                      body: a.body,
                      audience: a.audience,
                      sendEmail: a.sendEmail,
                    }}
                  >
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        {a.status === 'PUBLISHED' ? (
                          <Badge tone="success">公開中</Badge>
                        ) : (
                          <Badge tone="gray">下書き</Badge>
                        )}
                        <Badge tone={AUDIENCE_TONES[a.audience]}>
                          {AUDIENCE_SHORT_LABELS[a.audience]}
                        </Badge>
                        {a.sendEmail && (
                          <Badge tone={EMAIL_STATUS_TONES[a.emailStatus]}>
                            ✉️ {EMAIL_STATUS_LABELS[a.emailStatus]}
                          </Badge>
                        )}
                        <p className="text-base font-semibold text-slate-900">
                          {a.title}
                        </p>
                      </div>
                      <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">
                        {a.body}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>
                          作成: {formatDateTime(a.createdAt)}
                        </span>
                        <span>
                          更新: {formatDateTime(a.updatedAt)}
                        </span>
                        {a.publishedAt && (
                          <span>
                            公開: {formatDateTime(a.publishedAt)}
                          </span>
                        )}
                      </div>
                      {/* 公開 URL: 外部サイトへの掲載やアクセス元制限の登録に使う */}
                      <div className="mt-3 max-w-xl">
                        <AnnouncementLinkCopy
                          url={`${baseUrl}/notices/${a.id}`}
                          hint={
                            a.status === 'PUBLISHED'
                              ? undefined
                              : '下書きのため、この URL は管理者以外には表示されません（公開後に閲覧できます）。'
                          }
                        />
                      </div>
                      {a.sendEmail && a.emailStatus !== 'NOT_REQUESTED' && (
                        <p className="mt-1 text-xs text-slate-500">
                          配信対象: {a.emailRecipientCount ?? '—'} 件
                          {(a.emailStatus === 'COMPLETED' || a.emailStatus === 'SENDING') && (
                            <>
                              {' '}
                              / 成功: {a.emailSentCount ?? 0} 件
                              {(a.emailFailedCount ?? 0) > 0 && (
                                <span className="text-rose-600">
                                  {' '}
                                  / 失敗: {a.emailFailedCount} 件
                                </span>
                              )}
                            </>
                          )}
                          {a.emailStatus === 'FAILED' && a.emailError && (
                            <span className="text-rose-600"> / エラー: {a.emailError}</span>
                          )}
                        </p>
                      )}
                    </>
                  </AnnouncementListItem>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
