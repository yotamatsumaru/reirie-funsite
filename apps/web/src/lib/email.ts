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
