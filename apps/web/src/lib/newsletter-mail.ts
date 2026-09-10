/**
 * newsletter-mail — 会報誌 (PREMIUM 特典) 関連メールの一斉送信
 *
 * 提供する 2 種類:
 *   1. ADDRESS_REMINDER … 住所未記入の会員へ «ご登録のお願い»
 *   2. SHIPPING_NOTICE  … 発送完了のお知らせ
 *
 * 【二重送信を絶対に避ける設計】
 * 相手は実在の会員なので、二度押しで同じ案内が重複して届くと信用を損なう。
 * そこで NewsletterMailLog に (issueKey, kind, userId) の UNIQUE を張り、
 *
 *   1. 送信«前»に log 行を作成する (= 送信権の予約)
 *      → 既に行があれば UNIQUE 制約で弾かれ、その会員はスキップ
 *   2. 実際に送る
 *   3. 成功したら sentAt を、失敗したら error を記録
 *
 * という順序にしている。「送ってから記録」だと送信直後にサーバーが落ちた場合に
 * 記録が残らず、再実行で二重送信になる。先に予約することでこれを防ぐ。
 *
 * 【失敗した宛先の再送について】
 * 失敗行 (sentAt = null) は残るため、そのままでは再送されない。
 * 意図的な再送は «失敗分のみ» を対象にする retryFailed で行う。
 * (成功した人に再送されることは無い)
 */
import { prisma } from '@idol/db';
import {
  buildAddressReminderMail,
  buildShippingNoticeMail,
  isShippable,
  missingShippingFields,
  recipientName,
  type ShippingProfile,
} from '@idol/shared';
import { sendEmail } from '@/lib/email';

/** SES のスロットリングを避けるための送信間隔 (bulk-email と同じ方針) */
const SEND_INTERVAL_MS = 150;

/** 有効 (発送対象) とみなすサブスクステータス */
const LIVE_STATUSES = ['ACTIVE', 'TRIALING'] as const;

const SITE_NAME = 'ReiRieRoom';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type NewsletterMailKind = 'ADDRESS_REMINDER' | 'SHIPPING_NOTICE';

type TargetUser = ShippingProfile & {
  id: string;
  email: string;
  memberNumber: string | null;
};

/**
 * 会報誌の発送対象 (有効な PREMIUM 会員) を取得する。
 * 1 会員が複数の有効サブスクを持つ場合に備えて重複排除する。
 */
export async function fetchNewsletterTargets(): Promise<TargetUser[]> {
  const subs = await prisma.subscription.findMany({
    where: { planType: 'PREMIUM', status: { in: [...LIVE_STATUSES] } },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          memberNumber: true,
          fullName: true,
          displayName: true,
          furigana: true,
          postalCode: true,
          prefecture: true,
          addressLine1: true,
          addressLine2: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const seen = new Set<string>();
  const out: TargetUser[] = [];
  for (const s of subs) {
    const u = s.user;
    if (!u || seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}

export type SendResult = {
  /** 送信を試みた人数 */
  attempted: number;
  /** 成功した人数 */
  sent: number;
  /** 失敗した人数 */
  failed: number;
  /** 既に同じ号・種別で送信済みのためスキップした人数 */
  skippedAlreadySent: number;
  /** 条件に合わずスキップした人数 (住所が揃っている等) */
  skippedNotTarget: number;
  /** 失敗した宛先の詳細 (最大 20 件) */
  errors: { email: string; message: string }[];
};

function emptyResult(): SendResult {
  return {
    attempted: 0,
    sent: 0,
    failed: 0,
    skippedAlreadySent: 0,
    skippedNotTarget: 0,
    errors: [],
  };
}

/**
 * 1 通送る。二重送信防止のため «先に log 行を予約» する。
 * 既に行がある (= 送信済み or 送信試行済み) 場合は false を返す。
 */
async function sendOnce(params: {
  issueKey: string;
  kind: NewsletterMailKind;
  user: { id: string; email: string };
  subject: string;
  text: string;
  result: SendResult;
}): Promise<void> {
  const { issueKey, kind, user, subject, text, result } = params;

  let logId: string;
  try {
    const log = await prisma.newsletterMailLog.create({
      data: { issueKey, kind, userId: user.id, email: user.email },
      select: { id: true },
    });
    logId = log.id;
  } catch {
    // UNIQUE 制約違反 = 既に同じ号・種別で送信 (試行) 済み
    result.skippedAlreadySent += 1;
    return;
  }

  result.attempted += 1;
  try {
    await sendEmail({ to: user.email, subject, text });
    await prisma.newsletterMailLog.update({
      where: { id: logId },
      data: { sentAt: new Date() },
    });
    result.sent += 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.failed += 1;
    if (result.errors.length < 20) {
      result.errors.push({ email: user.email, message });
    }
    await prisma.newsletterMailLog.update({
      where: { id: logId },
      data: { error: message.slice(0, 1000) },
    });
    // eslint-disable-next-line no-console
    console.error('[newsletter-mail] failed to send to', user.email, err);
  }
}

/**
 * 住所が未記入の PREMIUM 会員へ «ご登録のお願い» メールを送る。
 *
 * 住所が揃っている会員には送らない (不要なメールは信用を損なう)。
 */
export async function sendAddressReminders(params: {
  issueKey: string;
  issueLabel: string;
  profileUrl: string;
  deadlineLabel?: string;
}): Promise<SendResult> {
  const result = emptyResult();
  const targets = await fetchNewsletterTargets();

  for (const u of targets) {
    // 住所が揃っている人には送らない
    if (isShippable(u)) {
      result.skippedNotTarget += 1;
      continue;
    }
    const missing = missingShippingFields(u);
    const { subject, text } = buildAddressReminderMail({
      name: recipientName(u),
      missing,
      issueLabel: params.issueLabel,
      profileUrl: params.profileUrl,
      deadlineLabel: params.deadlineLabel,
      siteName: SITE_NAME,
    });

    await sendOnce({
      issueKey: params.issueKey,
      kind: 'ADDRESS_REMINDER',
      user: u,
      subject,
      text,
      result,
    });
    await sleep(SEND_INTERVAL_MS);
  }

  return result;
}

/**
 * 発送完了のお知らせを送る。
 *
 * 【送る相手】
 * 発送可能だった会員 (= 実際に送った相手) のみ。
 * 住所未記入で発送できなかった会員に «発送しました» と送ると、
 * 届かない問い合わせを招くため除外する。
 */
export async function sendShippingNotices(params: {
  issueKey: string;
  issueLabel: string;
  shippedOnLabel: string;
  arrivalLabel?: string;
  note?: string;
}): Promise<SendResult> {
  const result = emptyResult();
  const targets = await fetchNewsletterTargets();

  for (const u of targets) {
    // 発送できていない人に「発送しました」は送らない
    if (!isShippable(u)) {
      result.skippedNotTarget += 1;
      continue;
    }
    const { subject, text } = buildShippingNoticeMail({
      name: recipientName(u),
      issueLabel: params.issueLabel,
      shippedOnLabel: params.shippedOnLabel,
      arrivalLabel: params.arrivalLabel,
      note: params.note,
      siteName: SITE_NAME,
    });

    await sendOnce({
      issueKey: params.issueKey,
      kind: 'SHIPPING_NOTICE',
      user: u,
      subject,
      text,
      result,
    });
    await sleep(SEND_INTERVAL_MS);
  }

  return result;
}

/**
 * 指定した号・種別の送信状況を取得する (画面表示用)。
 */
export async function getNewsletterMailStatus(issueKey: string): Promise<
  Record<NewsletterMailKind, { sent: number; failed: number }>
> {
  const logs = await prisma.newsletterMailLog.findMany({
    where: { issueKey },
    select: { kind: true, sentAt: true },
  });

  const base = {
    ADDRESS_REMINDER: { sent: 0, failed: 0 },
    SHIPPING_NOTICE: { sent: 0, failed: 0 },
  };
  for (const l of logs) {
    const k = l.kind as NewsletterMailKind;
    if (l.sentAt) base[k].sent += 1;
    else base[k].failed += 1;
  }
  return base;
}
