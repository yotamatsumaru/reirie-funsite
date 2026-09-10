/**
 * newsletter-shipping — 会報誌 (PREMIUM 特典・年2回) の発送に関する純ロジック
 *
 * 【扱う 2 つの通知】
 *  1. 住所未記入の会員への «記入のお願い» メール
 *     住所が無いと物理的に送れない。発送直前に気づいても間に合わないため、
 *     どの項目が足りないかを本人に伝えて自分で直してもらう。
 *  2. 発送完了の «お知らせ» メール
 *     「届かない」という問い合わせは、発送済みか分からないことが原因になりやすい。
 *     発送したことと目安の到着時期を伝えておく。
 *
 * DB / メール送信には依存しない純関数のみを置く (テスト可能に保つ)。
 */

/** 発送先として必要な会員情報 */
export type ShippingProfile = {
  fullName?: string | null;
  displayName?: string | null;
  furigana?: string | null;
  postalCode?: string | null;
  prefecture?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
};

/** 不足している項目のキー */
export type MissingField = 'name' | 'postalCode' | 'prefecture' | 'addressLine1';

/** 画面・メールで使う項目名 */
export const MISSING_FIELD_LABELS: Record<MissingField, string> = {
  name: 'お名前（本名）',
  postalCode: '郵便番号',
  prefecture: '都道府県',
  addressLine1: '住所（市区町村・番地）',
};

function isFilled(v: string | null | undefined): boolean {
  return v != null && v.trim() !== '';
}

/**
 * 宛名に使う氏名。本名を優先し、無ければ表示名。
 *
 * 【表示名を宛名に使う理由】
 * 本名が未登録でも表示名で届く場合があるため «発送不能» とは断定しない。
 * ただしニックネームのままだと配達できない可能性があるので、
 * 本名が無い場合は needsNameConfirmation で «確認推奨» として扱う。
 */
export function recipientName(p: ShippingProfile): string {
  return p.fullName?.trim() || p.displayName?.trim() || '';
}

/** 郵便番号を 123-4567 形式へ整形 (数字 7 桁のときのみ) */
export function formatPostalCode(pc: string | null | undefined): string {
  if (!isFilled(pc)) return '';
  const digits = pc!.replace(/[^0-9]/g, '');
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return pc!.trim();
}

/** 都道府県 + 住所1 + 住所2 を 1 行に連結 */
export function fullAddress(p: ShippingProfile): string {
  return [p.prefecture, p.addressLine1, p.addressLine2]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s))
    .join(' ');
}

/**
 * 発送に必要な情報のうち、足りないものを列挙する。
 * 順序は «上から埋めてもらう» ことを想定してフォームの並びに合わせる。
 */
export function missingShippingFields(p: ShippingProfile): MissingField[] {
  const missing: MissingField[] = [];
  if (!isFilled(recipientName(p))) missing.push('name');
  if (!isFilled(p.postalCode)) missing.push('postalCode');
  if (!isFilled(p.prefecture)) missing.push('prefecture');
  if (!isFilled(p.addressLine1)) missing.push('addressLine1');
  return missing;
}

/** 発送できる状態か (必須項目がすべて埋まっているか) */
export function isShippable(p: ShippingProfile): boolean {
  return missingShippingFields(p).length === 0;
}

/**
 * 「発送はできるが確認したほうがよい」ケース。
 * 本名が無く表示名 (ニックネーム) で発送することになる場合。
 * 宛名が「ぴよぴよ」等だと配達されない恐れがある。
 */
export function needsNameConfirmation(p: ShippingProfile): boolean {
  return !isFilled(p.fullName) && isFilled(p.displayName);
}

// ---------------------------------------------------------------
// メール文面
// ---------------------------------------------------------------

/** 会報誌の号 (例: 2026年 春号) */
export type NewsletterIssue = {
  /** 表示用の号名 (例: 「2026年 春号」「Vol.3」) */
  label: string;
};

export type MailContent = { subject: string; text: string };

/**
 * 住所未記入の会員へ送る «ご登録のお願い» メール。
 *
 * 【書き方の方針】
 * - 何が足りないかを名指しする (「情報が不足しています」だけでは直せない)
 * - どこで直せるかを示す (URL)
 * - 期限を明示する (いつまでに直せば今号に間に合うか)
 * - 責める書き方にしない (会員は «特典を受け取れない» 側なので不安になる)
 */
export function buildAddressReminderMail(params: {
  name: string;
  missing: MissingField[];
  issueLabel: string;
  /** 住所を編集できるページの絶対 URL */
  profileUrl: string;
  /** 「〜までにご登録ください」の締切表示 (省略可) */
  deadlineLabel?: string;
  siteName: string;
}): MailContent {
  const { name, missing, issueLabel, profileUrl, deadlineLabel, siteName } = params;
  const greeting = name ? `${name} 様` : 'プレミアム会員の皆さま';
  const list = missing.map((m) => `　・${MISSING_FIELD_LABELS[m]}`).join('\n');

  const subject = `【${siteName}】会報誌（${issueLabel}）お届け先のご登録のお願い`;

  const deadline = deadlineLabel
    ? `\nお手数ですが、${deadlineLabel}までにご登録をお願いいたします。\n（それ以降のご登録の場合、次号からのお届けとなる場合がございます）\n`
    : '';

  const text = [
    `${greeting}`,
    '',
    `いつも${siteName}をご利用いただきありがとうございます。`,
    '',
    `プレミアム会員の特典として、会報誌（${issueLabel}）をお届けいたします。`,
    'つきましては、お届け先の情報のうち以下が未登録となっております。',
    '',
    list,
    '',
    'お手数ですが、下記ページよりご登録をお願いいたします。',
    '',
    `　${profileUrl}`,
    deadline,
    '※ すでにご登録済みの場合は、本メールは行き違いですのでご容赦ください。',
    '',
    'ご不明な点がございましたら、お気軽にお問い合わせください。',
    '',
    `${siteName}`,
  ].join('\n');

  return { subject, text };
}

/**
 * 発送完了のお知らせメール。
 *
 * 【到着目安を書く理由】
 * 「発送しました」だけだと、翌日届かないと問い合わせになる。
 * 目安を書いておくと問い合わせが減る。
 */
export function buildShippingNoticeMail(params: {
  name: string;
  issueLabel: string;
  /** 発送日の表示 (例: 「2026年3月10日」) */
  shippedOnLabel: string;
  /** 到着目安の表示 (例: 「3〜5日程度」) */
  arrivalLabel?: string;
  siteName: string;
  /** 運営からの補足メッセージ (任意) */
  note?: string;
}): MailContent {
  const { name, issueLabel, shippedOnLabel, arrivalLabel, siteName, note } = params;
  const greeting = name ? `${name} 様` : 'プレミアム会員の皆さま';

  const subject = `【${siteName}】会報誌（${issueLabel}）を発送しました`;

  const arrival = arrivalLabel
    ? `お届けまで${arrivalLabel}お待ちください。\n`
    : '';

  const text = [
    `${greeting}`,
    '',
    `いつも${siteName}をご利用いただきありがとうございます。`,
    '',
    `プレミアム会員特典の会報誌（${issueLabel}）を`,
    `${shippedOnLabel}に発送いたしました。`,
    '',
    arrival,
    ...(note ? [note, ''] : []),
    'ご登録の住所へお届けいたします。',
    '万が一、一定期間を過ぎてもお手元に届かない場合は、',
    'お手数ですがお問い合わせよりご連絡ください。',
    '',
    'これからも楽しんでいただけるコンテンツをお届けしてまいります。',
    '',
    `${siteName}`,
  ].join('\n');

  return { subject, text };
}

// ---------------------------------------------------------------
// 発送対象の集計
// ---------------------------------------------------------------

export type RecipientSummary = {
  /** 発送対象の総数 */
  total: number;
  /** 発送可能な人数 */
  shippable: number;
  /** 住所などが足りず発送できない人数 */
  needsInfo: number;
  /** 発送はできるが宛名が本名でない (確認推奨) 人数 */
  needsNameCheck: number;
};

export function summarizeRecipients(
  profiles: readonly ShippingProfile[],
): RecipientSummary {
  let shippable = 0;
  let needsNameCheck = 0;
  for (const p of profiles) {
    if (isShippable(p)) {
      shippable += 1;
      if (needsNameConfirmation(p)) needsNameCheck += 1;
    }
  }
  return {
    total: profiles.length,
    shippable,
    needsInfo: profiles.length - shippable,
    needsNameCheck,
  };
}
