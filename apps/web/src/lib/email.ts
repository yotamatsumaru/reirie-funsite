/**
 * AWS SES ベースの簡易メール送信ヘルパ
 */
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { env } from './env';

let _ses: SESClient | null = null;
function ses(): SESClient {
  if (!_ses) _ses = new SESClient({ region: env.aws.region });
  return _ses;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (env.nodeEnv !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[email][dev]', params);
    return;
  }
  await ses().send(
    new SendEmailCommand({
      Source: env.ses.fromEmail,
      Destination: { ToAddresses: [params.to] },
      Message: {
        Subject: { Data: params.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: params.text, Charset: 'UTF-8' },
          ...(params.html ? { Html: { Data: params.html, Charset: 'UTF-8' } } : {}),
        },
      },
    }),
  );
}

/** HTML をエスケープ (メール本文に値を差し込む際の安全対策) */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 新規登録時のウェルカム & メール認証メールを送信する。
 *  - displayName: 宛名 (ニックネーム)
 *  - verifyUrl: メール認証用の絶対URL
 *  - siteName: サイト名 (件名・本文に使用)
 *
 * テキスト版と HTML 版の両方を送信し、認証ボタンを目立たせる。
 */
export async function sendWelcomeEmail(params: {
  to: string;
  displayName: string;
  verifyUrl: string;
  siteName?: string;
}): Promise<void> {
  const siteName = params.siteName ?? 'ReiRieRoom';
  const name = params.displayName?.trim() || 'お客';

  const text =
    `${name} さん\n\n` +
    `${siteName} へのご登録ありがとうございます！\n\n` +
    `ご利用を開始するには、以下のURLからメールアドレスの確認を完了してください。\n` +
    `${params.verifyUrl}\n\n` +
    `※ このリンクは安全のため、心当たりがない場合は破棄してください。\n\n` +
    `――――――――――\n${siteName} 運営事務局`;

  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(params.verifyUrl);
  const safeSite = escapeHtml(siteName);

  const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f1f7;font-family:'Hiragino Sans','Yu Gothic',sans-serif;color:#2d2235;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:linear-gradient(135deg,#4a2d5c,#7c5295);border-radius:16px 16px 0 0;padding:28px 24px;text-align:center;">
      <h1 style="margin:0;color:#fdf8ff;font-size:20px;letter-spacing:.05em;">${safeSite}</h1>
      <p style="margin:6px 0 0;color:#e9d8f5;font-size:12px;">ご登録ありがとうございます</p>
    </div>
    <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px 24px;box-shadow:0 4px 20px rgba(74,45,92,.08);">
      <p style="margin:0 0 16px;font-size:15px;">${safeName} さん、ようこそ！</p>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#5a4d66;">
        ご利用を開始するには、下のボタンからメールアドレスの確認を完了してください。
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${safeUrl}"
           style="display:inline-block;background:#7c5295;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 32px;border-radius:999px;">
          メールアドレスを確認する
        </a>
      </div>
      <p style="margin:0 0 8px;font-size:12px;color:#8a7d96;">ボタンが押せない場合は、以下のURLをブラウザに貼り付けてください。</p>
      <p style="margin:0 0 20px;font-size:12px;word-break:break-all;"><a href="${safeUrl}" style="color:#7c5295;">${safeUrl}</a></p>
      <hr style="border:none;border-top:1px solid #efeaf4;margin:20px 0;">
      <p style="margin:0;font-size:11px;color:#a99fb3;line-height:1.6;">
        心当たりがない場合は、このメールを破棄してください。<br>
        ${safeSite} 運営事務局
      </p>
    </div>
  </div>
</body></html>`;

  await sendEmail({
    to: params.to,
    subject: `【${siteName}】ご登録ありがとうございます（メール確認のお願い）`,
    text,
    html,
  });
}

/**
 * 新規登録時のメール認証コードを送信する。
 *  - code: 6桁の認証コード
 *  - expiresInMinutes: 有効期限 (分)
 *
 * テキスト版と HTML 版の両方を送信し、コードを大きく目立たせる。
 */
export async function sendVerificationCodeEmail(params: {
  to: string;
  displayName: string;
  code: string;
  expiresInMinutes: number;
  siteName?: string;
}): Promise<void> {
  const siteName = params.siteName ?? 'ReiRieRoom';
  const name = params.displayName?.trim() || 'お客';

  const text =
    `${name} さん\n\n` +
    `${siteName} へのご登録ありがとうございます！\n\n` +
    `以下の認証コードを登録画面に入力して、メールアドレスの確認を完了してください。\n\n` +
    `認証コード: ${params.code}\n\n` +
    `※ 有効期限は発行から${params.expiresInMinutes}分間です。\n` +
    `※ このメールに心当たりがない場合は破棄してください。\n\n` +
    `――――――――――\n${siteName} 運営事務局`;

  const safeName = escapeHtml(name);
  const safeCode = escapeHtml(params.code);
  const safeSite = escapeHtml(siteName);

  const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f1f7;font-family:'Hiragino Sans','Yu Gothic',sans-serif;color:#2d2235;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:linear-gradient(135deg,#4a2d5c,#7c5295);border-radius:16px 16px 0 0;padding:28px 24px;text-align:center;">
      <h1 style="margin:0;color:#fdf8ff;font-size:20px;letter-spacing:.05em;">${safeSite}</h1>
      <p style="margin:6px 0 0;color:#e9d8f5;font-size:12px;">ご登録ありがとうございます</p>
    </div>
    <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px 24px;box-shadow:0 4px 20px rgba(74,45,92,.08);">
      <p style="margin:0 0 16px;font-size:15px;">${safeName} さん、ようこそ！</p>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#5a4d66;">
        以下の認証コードを登録画面に入力して、メールアドレスの確認を完了してください。
      </p>
      <div style="text-align:center;margin:28px 0;">
        <div style="display:inline-block;background:#f4eef8;border:2px solid #7c5295;color:#4a2d5c;font-weight:bold;font-size:32px;letter-spacing:.25em;padding:16px 32px;border-radius:12px;">
          ${safeCode}
        </div>
      </div>
      <p style="margin:0 0 20px;font-size:12px;color:#8a7d96;text-align:center;">有効期限: 発行から${params.expiresInMinutes}分間</p>
      <hr style="border:none;border-top:1px solid #efeaf4;margin:20px 0;">
      <p style="margin:0;font-size:11px;color:#a99fb3;line-height:1.6;">
        心当たりがない場合は、このメールを破棄してください。<br>
        ${safeSite} 運営事務局
      </p>
    </div>
  </div>
</body></html>`;

  await sendEmail({
    to: params.to,
    subject: `【${siteName}】メール認証コード: ${params.code}`,
    text,
    html,
  });
}

/**
 * 管理者招待メールを送信する。
 *  - acceptUrl: 受諾ページへの絶対URL
 *  - isExistingUser: 既存ユーザー向けか（文面を出し分け）
 */
export async function sendAdminInvitationEmail(params: {
  to: string;
  acceptUrl: string;
  roleLabel: string;
  isExistingUser: boolean;
  expiresAt: Date;
  note?: string | null;
}): Promise<void> {
  const expiry = params.expiresAt.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const intro = params.isExistingUser
    ? `あなたのアカウントに「${params.roleLabel}」権限を付与する招待が届きました。\n以下のリンクからログインのうえ、招待を承認してください。`
    : `ファンサイトの「${params.roleLabel}」として招待されました。\n以下のリンクからアカウントを作成し、招待を承認してください。`;

  const noteBlock = params.note ? `\n\n招待者からのメモ:\n${params.note}` : '';

  const text =
    `${intro}\n\n` +
    `▼ 招待を承認する\n${params.acceptUrl}\n\n` +
    `このリンクの有効期限: ${expiry}\n` +
    `※ 期限を過ぎた場合は、招待者に再送を依頼してください。` +
    noteBlock +
    `\n\n心当たりがない場合は、このメールを破棄してください。`;

  await sendEmail({
    to: params.to,
    subject: `【ファンクラブ運営】管理者(${params.roleLabel})への招待`,
    text,
  });
}
