/**
 * お知らせの一斉メール送信 (Announcement → 対象ユーザー全員へ配信)
 *
 * 設計:
 *  - 対象は audience (ALL / MEMBERS / PREMIUM) に応じて users テーブルから絞り込む。
 *    - ALL は「公開ページで誰でも見られる」お知らせだが、メール送信対象は
 *      「メール配信に同意した会員 (marketingOptIn = true)」に限定する。
 *      (メールアドレスを持たない匿名の閲覧者には送れないため。
 *       また特定商取引法/迷惑メール防止法の観点でも、opt-in していない
 *       ユーザーへ広告目的のメールを送るべきではない)
 *    - MEMBERS / PREMIUM は「会員への重要なお知らせ」を想定し、
 *      marketingOptIn の有無を問わず全会員 (該当プラン) に送信する。
 *      (運営上必須の連絡は opt-out 対象にしない、という方針)
 *  - SES の送信レートには上限があるため、1件ずつ await しながら順次送信し、
 *    バッチ間に短い delay を挟むことでスロットリングを避ける。
 *  - 大量送信を Next.js のリクエストハンドラ内で同期的に await すると
 *    HTTP レスポンスがタイムアウトするため、呼び出し側は
 *    `void sendAnnouncementEmails(...)` のようにバックグラウンドで
 *    fire-and-forget し、進捗は Announcement.emailStatus 系フィールドを
 *    ポーリングして確認する設計とする。
 */
import { prisma } from '@idol/db';
import type { Announcement, AnnouncementAudience } from '@idol/db';
import { sendAnnouncementEmail } from './email';
import { logAudit } from './audit';

/** 1件送信ごとに空ける間隔 (ms)。SES 既定レート (最低 1件/秒) を安全に下回る値。 */
const SEND_INTERVAL_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * audience に応じて配信対象ユーザー (email, displayName) を取得する。
 *  - ALL     : marketingOptIn = true の会員のみ (opt-in 必須)
 *  - MEMBERS : 全会員 (opt-in 不問)
 *  - PREMIUM : PREMIUM プランの有効なサブスクリプションを持つ会員 (opt-in 不問)
 * 退会済み (deletedAt) / 未確認メール (emailVerified なし) は除外する。
 */
async function resolveRecipients(
  audience: AnnouncementAudience,
): Promise<{ id: string; email: string; displayName: string | null }[]> {
  const baseWhere = {
    deletedAt: null,
    emailVerified: { not: null },
  } as const;

  if (audience === 'ALL') {
    return prisma.user.findMany({
      where: { ...baseWhere, marketingOptIn: true },
      select: { id: true, email: true, displayName: true },
    });
  }

  if (audience === 'MEMBERS') {
    return prisma.user.findMany({
      where: baseWhere,
      select: { id: true, email: true, displayName: true },
    });
  }

  // PREMIUM: 有効なサブスクリプションが PREMIUM のユーザーのみ
  const users = await prisma.user.findMany({
    where: {
      ...baseWhere,
      subscriptions: {
        some: {
          planType: 'PREMIUM',
          status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
        },
      },
    },
    select: { id: true, email: true, displayName: true },
  });
  return users;
}

/**
 * Announcement を公開 & メール一斉送信する。
 *  - 対象ユーザーを確定し emailStatus = PENDING → SENDING に更新
 *  - 1件ずつ送信し、完了後に emailStatus = COMPLETED (一部失敗があっても COMPLETED とし、
 *    emailFailedCount で失敗数を可視化する)
 *  - 予期しない例外で処理が止まった場合は emailStatus = FAILED + emailError を記録
 *
 * fire-and-forget で呼び出すため、この関数内で例外を外に投げない
 * (呼び出し元の HTTP レスポンスには影響させない)。
 */
export async function sendAnnouncementEmails(announcementId: string): Promise<void> {
  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
  });
  if (!announcement) return;

  try {
    const recipients = await resolveRecipients(announcement.audience);

    await prisma.announcement.update({
      where: { id: announcementId },
      data: {
        emailStatus: 'SENDING',
        emailRecipientCount: recipients.length,
        emailSentCount: 0,
        emailFailedCount: 0,
        emailStartedAt: new Date(),
        emailError: null,
      },
    });

    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      try {
        await sendAnnouncementEmail({
          to: recipient.email,
          displayName: recipient.displayName ?? '',
          title: announcement.title,
          body: announcement.body,
        });
        sent += 1;
      } catch (err) {
        failed += 1;
        // eslint-disable-next-line no-console
        console.error('[bulk-email] failed to send to', recipient.email, err);
      }
      // SES のスロットリングを避けるため、送信間隔を空ける
      await sleep(SEND_INTERVAL_MS);
    }

    await prisma.announcement.update({
      where: { id: announcementId },
      data: {
        emailStatus: 'COMPLETED',
        emailSentCount: sent,
        emailFailedCount: failed,
        emailCompletedAt: new Date(),
      },
    });

    await logAudit({
      userId: announcement.authorId,
      action: 'announcement.email_sent',
      resource: `announcement:${announcementId}`,
      metadata: { recipients: recipients.length, sent, failed },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[bulk-email] announcement send failed', announcementId, err);
    await prisma.announcement
      .update({
        where: { id: announcementId },
        data: {
          emailStatus: 'FAILED',
          emailError: err instanceof Error ? err.message : 'unknown error',
        },
      })
      .catch(() => undefined);
  }
}

/**
 * 公開 (PUBLISHED) かつ sendEmail=true かつ未着手 (NOT_REQUESTED/FAILED) の
 * Announcement に対してメール一斉送信をキューイングする。
 * (公開ボタン押下時に呼ぶ。すでに送信済み/送信中のものは再送しない)
 */
export function shouldTriggerEmail(announcement: Announcement): boolean {
  return (
    announcement.status === 'PUBLISHED' &&
    announcement.sendEmail &&
    (announcement.emailStatus === 'NOT_REQUESTED' ||
      announcement.emailStatus === 'PENDING' ||
      announcement.emailStatus === 'FAILED')
  );
}
