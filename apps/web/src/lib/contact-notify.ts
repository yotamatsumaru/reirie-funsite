/**
 * お問い合わせの「控えメール」＆「運営への受信通知」。
 *
 * 【この機能を入れた理由】
 * 1) 会員様からのご要望:
 *      「お問い合わせした際に送った内容のコピーをメールアドレス宛に送る機能を
 *        つけてくださると届いているのか届いていないのかわかる」
 *    実際に POST /api/contact はレコードを保存するだけで、送信者へ何も
 *    送っていなかった。送信者は自分の問い合わせが届いたかを確認できなかった。
 * 2) 運営側の見落とし対策:
 *    ある問い合わせが 2 週間気づかれないまま放置された。原因は
 *    「新規問い合わせが届いても運営に通知が飛ばない」こと。管理画面を
 *    自発的に開かないと気づけない設計だった。控えメールだけ入れても
 *    運営側の見落としは解決しないため、受信通知もセットで実装する。
 *
 * 【最重要の設計方針: メール送信の失敗で問い合わせを失わない】
 * 問い合わせレコード (ContactMessage) が唯一の正であり、メールは付随物。
 * SES 障害・宛先の誤設定・送信元未検証などでメールが落ちても、
 * 「お問い合わせは受け付けた」状態を必ず維持する。
 * そのため送信は必ず try/catch で包み、結果 (成否・エラー理由) を
 * ContactMessage の ack_mail_* / admin_notify_* 列に記録する。
 * これにより「受け付けたが控えが届いていない」問い合わせを管理画面から
 * 特定でき、運営が再送・個別連絡を判断できる。
 */
import { prisma } from '@idol/db';
import {
  CONTACT_CATEGORY_LABELS,
  buildContactEchoBlock,
  formatContactReceivedAt,
  adminRecipientsExcludingSender,
  shouldNotifyAdmins,
  type ContactCategoryLiteral,
  type ContactNotificationSettings,
} from '@idol/shared';
import { sendEmail } from './email';
import { env } from './env';
import { getContactNotificationSettings } from './app-setting';

const SITE_NAME = 'ReiRieRoom';

function siteUrl(): string {
  return env.appBaseUrl.replace(/\/$/, '');
}

/** HTML エスケープ (メール本文に入力値を差し込む際の安全対策)。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type ContactNotifyTarget = {
  id: string;
  ticketNumber: string;
  name: string;
  email: string;
  category: ContactCategoryLiteral;
  subject: string;
  message: string;
  createdAt: Date;
  /** ログイン会員からの送信か (控えメールの案内文を出し分ける)。 */
  isMember: boolean;
  /** 会員番号 (運営通知に載せて本人特定を早くする)。 */
  memberNumber?: string | null;
};

export type ContactNotifyResult = {
  ackMailSent: boolean;
  ackMailError: string | null;
  adminNotified: boolean;
  adminNotifyError: string | null;
  /** 実際に通知を送った運営宛先の件数 (0 = 未設定 or OFF)。 */
  adminRecipientCount: number;
};

// ---------------------------------------------------------------------------
// 送信内容の控えメール (送信者本人宛)
// ---------------------------------------------------------------------------

/** 控えメールのプレーンテキスト版。 */
export function buildContactAckText(t: ContactNotifyTarget): string {
  const echo = buildContactEchoBlock({
    ticketNumber: t.ticketNumber,
    categoryLabel: CONTACT_CATEGORY_LABELS[t.category],
    subject: t.subject,
    message: t.message,
    name: t.name,
    email: t.email,
    receivedAtLabel: formatContactReceivedAt(t.createdAt),
  });

  const mypageNotice = t.isMember
    ? `運営からの回答は、このメールアドレス宛および\n` +
      `マイページの「運営からのお知らせ」でご確認いただけます。\n` +
      `${siteUrl()}/me\n\n`
    : `運営からの回答は、このメールアドレス宛にお送りします。\n\n`;

  return (
    `${t.name} 様\n\n` +
    `${SITE_NAME} へお問い合わせいただきありがとうございます。\n` +
    `以下の内容を受け付けました。このメールは送信内容の控えです。\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${echo}\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `内容を確認のうえ、担当者より順次ご連絡いたします。\n` +
    mypageNotice +
    `※このメールは送信内容の自動控えです。このメールへの返信では\n` +
    `　運営に届かない場合があります。追加のご連絡はお問い合わせフォーム\n` +
    `　（${siteUrl()}/contact）からお願いいたします。\n` +
    `　その際、上記の受付番号をお知らせいただくとスムーズです。\n\n` +
    `――――――――――\n` +
    `${SITE_NAME} | REIRIE 公式ファンクラブ\n` +
    `${siteUrl()}`
  );
}

/** 控えメールの HTML 版 (サイトのトンマナに合わせる)。 */
export function buildContactAckHtml(t: ContactNotifyTarget): string {
  const url = siteUrl();
  const safeName = escapeHtml(t.name);
  const safeSubject = escapeHtml(t.subject);
  const safeMessage = escapeHtml(t.message).replace(/\n/g, '<br>');
  const safeTicket = escapeHtml(t.ticketNumber);
  const safeEmail = escapeHtml(t.email);
  const categoryLabel = escapeHtml(CONTACT_CATEGORY_LABELS[t.category]);
  const receivedAt = escapeHtml(formatContactReceivedAt(t.createdAt));

  const mypageBlock = t.isMember
    ? `<p style="margin:0 0 18px;font-size:13px;line-height:1.7;color:#6b7280;">
         運営からの回答は、このメールアドレス宛および
         マイページの「運営からのお知らせ」でご確認いただけます。<br>
         <a href="${escapeHtml(`${url}/me`)}" style="color:#a84f89;text-decoration:underline;">マイページを開く →</a>
       </p>`
    : `<p style="margin:0 0 18px;font-size:13px;line-height:1.7;color:#6b7280;">
         運営からの回答は、このメールアドレス宛にお送りします。
       </p>`;

  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(106,47,87,0.10);">
        <tr><td style="background:linear-gradient(135deg,#c263a2 0%,#a84f89 55%,#6a2f57 100%);padding:26px 28px;">
          <div style="font-size:20px;font-weight:700;letter-spacing:0.08em;color:#ffffff;">${SITE_NAME}</div>
          <div style="margin-top:4px;font-size:12px;letter-spacing:0.14em;color:rgba(255,255,255,0.85);">お問い合わせを受け付けました</div>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 14px;font-size:15px;color:#1f2937;">${safeName} 様</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.8;color:#374151;">
            ${SITE_NAME} へお問い合わせいただきありがとうございます。<br>
            以下の内容を受け付けました。<strong>このメールは送信内容の控えです。</strong>
          </p>

          <div style="margin:0 0 18px;padding:14px 16px;background:#faf7fc;border:1px solid #efe2ee;border-radius:10px;">
            <div style="font-size:11px;letter-spacing:0.08em;color:#a84f89;font-weight:700;">受付番号</div>
            <div style="margin-top:4px;font-size:20px;font-weight:700;letter-spacing:0.06em;color:#6a2f57;font-family:'SFMono-Regular',Consolas,monospace;">${safeTicket}</div>
            <div style="margin-top:6px;font-size:12px;color:#9ca3af;">お問い合わせの際はこの番号をお知らせください</div>
          </div>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;font-size:13px;color:#4b5563;">
            <tr><td style="padding:4px 0;width:88px;color:#9ca3af;">受付日時</td><td style="padding:4px 0;">${receivedAt}</td></tr>
            <tr><td style="padding:4px 0;color:#9ca3af;">お名前</td><td style="padding:4px 0;">${safeName}</td></tr>
            <tr><td style="padding:4px 0;color:#9ca3af;">メール</td><td style="padding:4px 0;">${safeEmail}</td></tr>
            <tr><td style="padding:4px 0;color:#9ca3af;">種別</td><td style="padding:4px 0;">${categoryLabel}</td></tr>
            <tr><td style="padding:4px 0;color:#9ca3af;">件名</td><td style="padding:4px 0;font-weight:600;color:#1f2937;">${safeSubject}</td></tr>
          </table>

          <div style="margin:10px 0 20px;">
            <div style="margin-bottom:6px;font-size:12px;color:#9ca3af;">お問い合わせ内容</div>
            <div style="padding:14px 16px;background:#f8fafc;border:1px solid #eef2f7;border-radius:8px;font-size:13px;line-height:1.9;color:#374151;">
              ${safeMessage}
            </div>
          </div>

          <p style="margin:0 0 8px;font-size:14px;line-height:1.8;color:#374151;">
            内容を確認のうえ、担当者より順次ご連絡いたします。
          </p>
          ${mypageBlock}

          <p style="margin:0;padding:12px 14px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:6px;font-size:12px;line-height:1.8;color:#92400e;">
            ※このメールは送信内容の自動控えです。このメールへの返信では運営に届かない場合があります。
            追加のご連絡は<a href="${escapeHtml(`${url}/contact`)}" style="color:#92400e;text-decoration:underline;">お問い合わせフォーム</a>からお願いいたします。
            その際、上記の受付番号をお知らせいただくとスムーズです。
          </p>
        </td></tr>
        <tr><td style="padding:18px 28px 26px;border-top:1px solid #f0eef5;">
          <div style="font-size:12px;color:#9ca3af;line-height:1.7;">
            ${SITE_NAME} | REIRIE 公式ファンクラブ<br>
            <a href="${escapeHtml(url)}" style="color:#a84f89;text-decoration:none;">${escapeHtml(url)}</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// 運営への新規受信通知
// ---------------------------------------------------------------------------

/** 運営通知メールのプレーンテキスト版。 */
export function buildContactAdminNotifyText(t: ContactNotifyTarget): string {
  const echo = buildContactEchoBlock({
    ticketNumber: t.ticketNumber,
    categoryLabel: CONTACT_CATEGORY_LABELS[t.category],
    subject: t.subject,
    message: t.message,
    name: t.name,
    email: t.email,
    receivedAtLabel: formatContactReceivedAt(t.createdAt),
  });
  const memberLine = t.isMember
    ? `会員   : ログイン会員${t.memberNumber ? ` (会員番号: ${t.memberNumber})` : ''}\n`
    : `会員   : ゲスト送信 (未ログイン)\n`;

  return (
    `新しいお問い合わせが届きました。\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${echo}\n` +
    memberLine +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `管理画面で対応状況を更新してください:\n` +
    `${siteUrl()}/super-admin/contact\n\n` +
    `――――――――――\n` +
    `${SITE_NAME} 管理通知 (自動送信)`
  );
}

/** 運営通知メールの HTML 版 (装飾は控えめ・情報密度優先)。 */
export function buildContactAdminNotifyHtml(t: ContactNotifyTarget): string {
  const url = siteUrl();
  const safeName = escapeHtml(t.name);
  const safeSubject = escapeHtml(t.subject);
  const safeMessage = escapeHtml(t.message).replace(/\n/g, '<br>');
  const safeTicket = escapeHtml(t.ticketNumber);
  const safeEmail = escapeHtml(t.email);
  const categoryLabel = escapeHtml(CONTACT_CATEGORY_LABELS[t.category]);
  const receivedAt = escapeHtml(formatContactReceivedAt(t.createdAt));
  const memberLabel = t.isMember
    ? `ログイン会員${t.memberNumber ? ` (会員番号: ${escapeHtml(t.memberNumber)})` : ''}`
    : 'ゲスト送信 (未ログイン)';

  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:20px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:#0f172a;padding:18px 24px;">
          <div style="font-size:12px;letter-spacing:0.14em;color:#94a3b8;">${SITE_NAME} 管理通知</div>
          <div style="margin-top:4px;font-size:17px;font-weight:700;color:#ffffff;">新しいお問い合わせが届きました</div>
        </td></tr>
        <tr><td style="padding:22px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#334155;">
            <tr><td style="padding:5px 0;width:92px;color:#94a3b8;">受付番号</td><td style="padding:5px 0;font-family:'SFMono-Regular',Consolas,monospace;font-weight:700;color:#0f172a;">${safeTicket}</td></tr>
            <tr><td style="padding:5px 0;color:#94a3b8;">受付日時</td><td style="padding:5px 0;">${receivedAt}</td></tr>
            <tr><td style="padding:5px 0;color:#94a3b8;">お名前</td><td style="padding:5px 0;">${safeName}</td></tr>
            <tr><td style="padding:5px 0;color:#94a3b8;">メール</td><td style="padding:5px 0;"><a href="mailto:${safeEmail}" style="color:#2563eb;">${safeEmail}</a></td></tr>
            <tr><td style="padding:5px 0;color:#94a3b8;">種別</td><td style="padding:5px 0;">${categoryLabel}</td></tr>
            <tr><td style="padding:5px 0;color:#94a3b8;">送信者</td><td style="padding:5px 0;">${memberLabel}</td></tr>
            <tr><td style="padding:5px 0;color:#94a3b8;">件名</td><td style="padding:5px 0;font-weight:700;color:#0f172a;">${safeSubject}</td></tr>
          </table>

          <div style="margin:16px 0 20px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;line-height:1.9;color:#1e293b;">
            ${safeMessage}
          </div>

          <a href="${escapeHtml(`${url}/super-admin/contact`)}"
             style="display:inline-block;padding:11px 22px;background:#0f172a;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;border-radius:8px;">
            管理画面で対応する →
          </a>
        </td></tr>
        <tr><td style="padding:14px 24px 20px;border-top:1px solid #eef2f7;">
          <div style="font-size:11px;color:#94a3b8;line-height:1.7;">
            この通知は運営向けの自動送信です。宛先は「システム設定 → お問い合わせ通知」で変更できます。
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// 送信の実行 + 結果の記録
// ---------------------------------------------------------------------------

/**
 * 控えメール & 運営通知を送信し、結果を ContactMessage に記録する。
 *
 * **この関数は例外を投げない。** 呼び出し元 (POST /api/contact) が
 * メール障害で 500 を返してしまうと、会員は「送信に失敗した」と受け取り
 * 同じ問い合わせを何度も送ってしまう (実際には保存済み)。
 * よって内部のあらゆる失敗は捕捉し、結果オブジェクトとして返す。
 *
 * @param settings 事前に取得済みの通知設定 (未指定なら内部で取得)。
 *                 テストから決定的に振る舞いを固定できるよう注入可能。
 */
export async function sendContactNotifications(
  target: ContactNotifyTarget,
  settings?: ContactNotificationSettings,
): Promise<ContactNotifyResult> {
  const result: ContactNotifyResult = {
    ackMailSent: false,
    ackMailError: null,
    adminNotified: false,
    adminNotifyError: null,
    adminRecipientCount: 0,
  };

  let effective: ContactNotificationSettings;
  try {
    effective = settings ?? (await getContactNotificationSettings());
  } catch (e) {
    // 設定が読めない場合でも問い合わせ自体は成立させる。
    result.ackMailError = `通知設定の読み込みに失敗: ${errMessage(e)}`;
    result.adminNotifyError = result.ackMailError;
    await recordResult(target.id, result);
    return result;
  }

  // --- 1) 送信者本人への控えメール ---
  if (effective.ackMailEnabled) {
    try {
      await sendEmail({
        to: target.email,
        subject: `【${SITE_NAME}】お問い合わせを受け付けました（${target.ticketNumber}）`,
        text: buildContactAckText(target),
        html: buildContactAckHtml(target),
      });
      result.ackMailSent = true;
    } catch (e) {
      result.ackMailError = errMessage(e);
    }
  } else {
    result.ackMailError = '控えメールは設定で無効化されています';
  }

  // --- 2) 運営への受信通知 ---
  if (shouldNotifyAdmins(effective)) {
    // 送信者自身が運営宛先に含まれる場合は除外 (同じ受信箱に 2 通届くのを防ぐ)。
    const recipients = adminRecipientsExcludingSender(effective, target.email);
    result.adminRecipientCount = recipients.length;
    if (recipients.length === 0) {
      result.adminNotifyError = '運営宛先が送信者と同一のため通知をスキップしました';
    } else {
      const text = buildContactAdminNotifyText(target);
      const html = buildContactAdminNotifyHtml(target);
      const subject = `[新規問い合わせ] ${target.subject}（${target.ticketNumber}）`;
      const failures: string[] = [];
      // 1 件失敗しても残りへは送る (宛先の一部だけタイプミスしているケースを想定)。
      for (const to of recipients) {
        try {
          await sendEmail({ to, subject, text, html });
        } catch (e) {
          failures.push(`${to}: ${errMessage(e)}`);
        }
      }
      // 1 件でも成功していれば「運営に通知は届いた」と扱う。
      result.adminNotified = failures.length < recipients.length;
      result.adminNotifyError = failures.length > 0 ? failures.join(' / ') : null;
    }
  } else if (!effective.adminNotifyEnabled) {
    result.adminNotifyError = '運営通知は設定で無効化されています';
  } else {
    result.adminNotifyError =
      '運営通知の宛先が未設定です（システム設定 → お問い合わせ通知 で登録してください）';
  }

  await recordResult(target.id, result);
  return result;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 送信結果を ContactMessage に記録する。
 * ここでの DB 更新失敗も握りつぶす (記録が残らないだけで、
 * 問い合わせ本体とメール送信の結果には影響しない)。
 */
async function recordResult(contactId: string, r: ContactNotifyResult): Promise<void> {
  try {
    await prisma.contactMessage.update({
      where: { id: contactId },
      data: {
        ackMailSent: r.ackMailSent,
        ackMailSentAt: r.ackMailSent ? new Date() : null,
        ackMailError: r.ackMailError,
        adminNotifiedAt: r.adminNotified ? new Date() : null,
        adminNotifyError: r.adminNotifyError,
      },
    });
  } catch {
    // 記録できなくても問い合わせは成立している (最悪、管理画面の表示が欠けるだけ)。
  }
}
