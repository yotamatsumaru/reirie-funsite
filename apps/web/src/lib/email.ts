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
