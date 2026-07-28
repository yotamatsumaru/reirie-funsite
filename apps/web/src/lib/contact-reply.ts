/**
 * お問い合わせへの運営返信機能のサーバーサイドヘルパ。
 *
 *  - createContactReply : 返信を保存し、問い合わせ者へメール通知する。任意で
 *    対応状況を「対応済み(RESOLVED)」に更新する。送信者がログイン会員なら
 *    マイページの「運営からのお知らせ」にも表示される (ContactReply.userId 経由)。
 *  - listMyContactReplies : マイページ用。ログイン会員が受け取った返信を新しい順で返す。
 *  - markContactReplyRead : マイページで返信を開いたときに既読化する (本人のもののみ)。
 *
 * メール送信に失敗しても返信レコード自体は残す (emailSent=false / emailError に記録)。
 * これにより「返信は記録されたがメールだけ落ちた」ケースを管理画面で把握・再送できる。
 */
import { prisma } from '@idol/db';
import type { ContactReply } from '@idol/db';
import { sendEmail } from './email';
import { env } from './env';

// ---------------------------------------------------------------------------
// 返信の作成 + メール通知
// ---------------------------------------------------------------------------

export type CreateContactReplyResult = {
  reply: ContactReply;
  emailSent: boolean;
  emailError: string | null;
};

/**
 * お問い合わせへの返信を作成し、問い合わせ者へメール通知する。
 * @param contactMessageId 返信対象の問い合わせ ID
 * @param body             返信本文
 * @param repliedById      返信した運営者の userId
 * @param markResolved     true なら対応状況を RESOLVED に更新する
 */
export async function createContactReply(params: {
  contactMessageId: string;
  body: string;
  repliedById: string;
  markResolved: boolean;
}): Promise<CreateContactReplyResult> {
  const { contactMessageId, body, repliedById, markResolved } = params;

  const contact = await prisma.contactMessage.findUnique({
    where: { id: contactMessageId },
    select: { id: true, name: true, email: true, subject: true, message: true, userId: true },
  });
  if (!contact) {
    throw new Error('お問い合わせが見つかりません');
  }

  // 先に返信レコードを作成 (メール送信の成否に関わらず記録を残す)。
  const reply = await prisma.contactReply.create({
    data: { contactMessageId, body, repliedById },
  });

  // 対応状況を更新 (任意)。返信＝対応完了とみなすデフォルト挙動。
  if (markResolved) {
    await prisma.contactMessage.update({
      where: { id: contactMessageId },
      data: { status: 'RESOLVED' },
    });
  }

  // メール通知。失敗しても返信は残し、emailError に理由を記録する。
  let emailSent = false;
  let emailError: string | null = null;
  try {
    const subject = `Re: ${contact.subject}`;
    const text = buildReplyMailText({
      name: contact.name,
      originalSubject: contact.subject,
      originalMessage: contact.message,
      body,
      isMember: Boolean(contact.userId),
    });
    const html = buildReplyMailHtml({
      name: contact.name,
      originalSubject: contact.subject,
      originalMessage: contact.message,
      body,
      isMember: Boolean(contact.userId),
    });
    await sendEmail({ to: contact.email, subject, text, html });
    emailSent = true;
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e);
  }

  const updated = await prisma.contactReply.update({
    where: { id: reply.id },
    data: { emailSent, emailError },
  });

  return { reply: updated, emailSent, emailError };
}

// ---------------------------------------------------------------------------
// マイページ用: 会員が受け取った運営からの返信
// ---------------------------------------------------------------------------

export type MyContactReply = {
  id: string;
  subject: string; // 元の問い合わせ件名
  body: string; // 運営からの返信本文
  createdAt: Date;
  readAt: Date | null;
};

/**
 * ログイン会員が受け取った運営からの返信を新しい順で返す。
 * 自分が送った問い合わせ (ContactMessage.userId === userId) への返信のみ。
 */
export async function listMyContactReplies(userId: string): Promise<MyContactReply[]> {
  const rows = await prisma.contactReply.findMany({
    where: { contactMessage: { userId } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      body: true,
      createdAt: true,
      readAt: true,
      contactMessage: { select: { subject: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    subject: r.contactMessage.subject,
    body: r.body,
    createdAt: r.createdAt,
    readAt: r.readAt,
  }));
}

/** ログイン会員の未読の運営返信件数 (マイページのバッジ用)。 */
export async function countUnreadContactReplies(userId: string): Promise<number> {
  return prisma.contactReply.count({
    where: { contactMessage: { userId }, readAt: null },
  });
}

/** 会員が返信を閲覧したら既読にする (本人が受け取ったもののみ)。 */
export async function markContactReplyRead(params: {
  userId: string;
  replyId: string;
}): Promise<void> {
  await prisma.contactReply.updateMany({
    where: {
      id: params.replyId,
      readAt: null,
      contactMessage: { userId: params.userId },
    },
    data: { readAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// メール本文の生成
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** マイページで確認できる旨の案内 (会員のみ)。 */
function mypageNoticeText(isMember: boolean): string {
  const mypageUrl = `${env.appBaseUrl.replace(/\/$/, '')}/me`;
  return isMember
    ? `この回答はマイページの「運営からのお知らせ」でも確認できます。\n${mypageUrl}\n\n`
    : '';
}

/** お問い合わせ返信メールのプレーンテキスト版。 */
export function buildReplyMailText(params: {
  name: string;
  originalSubject: string;
  originalMessage: string;
  body: string;
  isMember: boolean;
}): string {
  return (
    `${params.name} 様\n\n` +
    `お問い合わせいただきありがとうございます。\n` +
    `以下のとおり回答いたします。\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${params.body}\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    mypageNoticeText(params.isMember) +
    `＜お問い合わせ内容＞\n` +
    `件名: ${params.originalSubject}\n` +
    `${params.originalMessage}\n\n` +
    `――――――――――\n` +
    `ReiRieRoom | REIRIE 公式ファンクラブ\n` +
    `${env.appBaseUrl.replace(/\/$/, '')}`
  );
}

/**
 * お問い合わせ返信メールの HTML 版。サイトのトンマナ (マゼンタ〜ラベンダー) に合わせる。
 * 本文の改行は <br> に変換。元の問い合わせ内容は引用として控えめに表示。
 */
export function buildReplyMailHtml(params: {
  name: string;
  originalSubject: string;
  originalMessage: string;
  body: string;
  isMember: boolean;
}): string {
  const safeBody = escapeHtml(params.body).replace(/\n/g, '<br>');
  const safeName = escapeHtml(params.name);
  const safeSubject = escapeHtml(params.originalSubject);
  const safeOriginal = escapeHtml(params.originalMessage).replace(/\n/g, '<br>');
  const siteUrl = env.appBaseUrl.replace(/\/$/, '');
  const mypageUrl = `${siteUrl}/me`;

  const mypageBlock = params.isMember
    ? `<p style="margin:0 0 20px;font-size:13px;line-height:1.7;color:#6b7280;">
         この回答はマイページの「運営からのお知らせ」でも確認できます。<br>
         <a href="${escapeHtml(mypageUrl)}" style="color:#a84f89;text-decoration:underline;">マイページを開く →</a>
       </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(106,47,87,0.10);">
        <tr><td style="background:linear-gradient(135deg,#c263a2 0%,#a84f89 55%,#6a2f57 100%);padding:26px 28px;">
          <div style="font-size:20px;font-weight:700;letter-spacing:0.08em;color:#ffffff;">ReiRieRoom</div>
          <div style="margin-top:4px;font-size:12px;letter-spacing:0.14em;color:rgba(255,255,255,0.85);">お問い合わせへの回答</div>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 14px;font-size:15px;color:#1f2937;">${safeName} 様</p>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.8;color:#374151;">
            お問い合わせいただきありがとうございます。以下のとおり回答いたします。
          </p>
          <div style="margin:0 0 22px;padding:18px 18px;background:#faf7fc;border-left:4px solid #c263a2;border-radius:8px;font-size:14px;line-height:1.9;color:#1f2937;">
            ${safeBody}
          </div>
          ${mypageBlock}
          <div style="margin:0 0 6px;font-size:12px;color:#9ca3af;">＜お問い合わせ内容＞</div>
          <div style="padding:14px 16px;background:#f8fafc;border:1px solid #eef2f7;border-radius:8px;font-size:13px;line-height:1.8;color:#6b7280;">
            <div style="font-weight:600;color:#4b5563;">件名: ${safeSubject}</div>
            <div style="margin-top:6px;">${safeOriginal}</div>
          </div>
        </td></tr>
        <tr><td style="padding:18px 28px 26px;border-top:1px solid #f0eef5;">
          <div style="font-size:12px;color:#9ca3af;line-height:1.7;">
            ReiRieRoom | REIRIE 公式ファンクラブ<br>
            <a href="${escapeHtml(siteUrl)}" style="color:#a84f89;text-decoration:none;">${escapeHtml(siteUrl)}</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
