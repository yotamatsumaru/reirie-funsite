/**
 * 誕生日メール機能のサーバーサイドヘルパ。
 *
 *  - 年ごとのテンプレート (BirthdayMailTemplate) の取得・保存・画像アップロード。
 *  - 「今日が誕生日」の会員一覧、および「今年まだ未送信」の会員一覧の取得。
 *  - 実際の送信 (SES) と配信記録 (BirthdayMailDelivery) の作成 (二重送信防止つき)。
 *
 * 画像の保存方針は site-image.ts と同一:
 *   1. S3 アセットバケットが設定済み → S3 にアップロードし url は外部URL、data は null。
 *   2. 未設定 → バイト列を DB (BirthdayMailTemplate.imageData) に保存し、
 *      /api/media/birthday-mail/{id} 経由で配信する。
 *
 * 誕生日の「今日」判定は JST (Asia/Tokyo) の月日で行う。サーバーが UTC 稼働でも
 * 日本時間の誕生日でリストアップできるようにするため。
 */
import crypto from 'node:crypto';
import { prisma } from '@idol/db';
import type { BirthdayMailTemplate, BirthdayMailDelivery } from '@idol/db';
import { renderBirthdayMailText } from '@idol/shared';
import { isAssetStorageConfigured, putAsset } from './s3';
import { sendEmail } from './email';
import { env } from './env';

// ---------------------------------------------------------------------------
// JST 日付ユーティリティ
// ---------------------------------------------------------------------------

/** JST における現在の年月日を { year, month, day } で返す。 */
export function jstToday(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** birthDate (Date, DBは @db.Date でUTC 00:00 保存) から月日を取り出す。 */
function birthMonthDay(birthDate: Date): { month: number; day: number } {
  // @db.Date は時刻を持たず UTC 00:00 になるため、UTC の月日をそのまま使う。
  const d = new Date(birthDate);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// ---------------------------------------------------------------------------
// テンプレート (年ごと)
// ---------------------------------------------------------------------------

/** 指定年のテンプレートを取得 (なければ null)。 */
export async function getBirthdayTemplate(
  year: number,
): Promise<BirthdayMailTemplate | null> {
  return prisma.birthdayMailTemplate.findUnique({ where: { year } });
}

/** 全テンプレートを年の降順で取得 (管理画面の年セレクタ用)。 */
export async function listBirthdayTemplates(): Promise<BirthdayMailTemplate[]> {
  const rows = await prisma.birthdayMailTemplate.findMany({});
  return [...rows].sort((a, b) => b.year - a.year);
}

/** テンプレートを保存 (upsert)。画像は saveBirthdayTemplateImage で別途更新。 */
export async function upsertBirthdayTemplate(params: {
  year: number;
  subject: string;
  body: string;
  enabled: boolean;
}): Promise<BirthdayMailTemplate> {
  const { year, subject, body, enabled } = params;
  return prisma.birthdayMailTemplate.upsert({
    where: { year },
    create: { year, subject, body, enabled },
    update: { subject, body, enabled },
  });
}

/** テンプレートの画像を保存 (既存があれば置き換え)。テンプレートは事前に存在させること。 */
export async function saveBirthdayTemplateImage(params: {
  year: number;
  bytes: Buffer;
  contentType: string;
  ext: string;
  fileName: string | null;
}): Promise<BirthdayMailTemplate> {
  const { year, bytes, contentType, ext, fileName } = params;

  if (isAssetStorageConfigured()) {
    const key = `birthday-mail/${year}-${crypto.randomUUID()}.${ext}`;
    const url = await putAsset(key, bytes, contentType);
    return prisma.birthdayMailTemplate.update({
      where: { year },
      data: {
        imageUrl: url,
        imageContentType: contentType,
        imageFileName: fileName,
        imageSizeBytes: bytes.byteLength,
        imageData: null,
      },
    });
  }

  // DB 保存フォールバック: まず data を保存し、url を id ベースにする。
  const base = await prisma.birthdayMailTemplate.update({
    where: { year },
    data: {
      imageContentType: contentType,
      imageFileName: fileName,
      imageSizeBytes: bytes.byteLength,
      imageData: bytes,
    },
  });
  const url = `/api/media/birthday-mail/${base.id}?v=${base.updatedAt.getTime()}`;
  return prisma.birthdayMailTemplate.update({
    where: { year },
    data: { imageUrl: url },
  });
}

/** テンプレートの画像を削除。 */
export async function clearBirthdayTemplateImage(year: number): Promise<void> {
  await prisma.birthdayMailTemplate.update({
    where: { year },
    data: {
      imageUrl: null,
      imageContentType: null,
      imageFileName: null,
      imageSizeBytes: null,
      imageData: null,
    },
  });
}

// ---------------------------------------------------------------------------
// 送信対象者のリストアップ
// ---------------------------------------------------------------------------

export type BirthdayRecipient = {
  id: string;
  email: string;
  displayName: string | null;
  preferredName: string | null;
  fullName: string | null;
  birthDate: Date;
  /** 対象年に配信済みか (配信記録があれば true)。 */
  sent: boolean;
  /** 配信済みの場合の送信日時。 */
  sentAt: Date | null;
  /** 送信できたか (SES 成功)。記録のみ (email_sent=false) は再送対象。 */
  emailSent: boolean;
};

/** メールで使う会員の呼び名を決める (preferredName > displayName > fullName > "会員")。 */
export function resolveRecipientName(u: {
  preferredName: string | null;
  displayName: string | null;
  fullName: string | null;
}): string {
  return u.preferredName?.trim() || u.displayName?.trim() || u.fullName?.trim() || '会員';
}

/**
 * 指定した月日が誕生日の会員を取得し、対象年の配信状況を付与して返す。
 *  - month/day を省略すると JST の「今日」を対象にする。
 *  - 退会・BAN 済み (deletedAt / bannedAt) は除外。メール未確認でも対象に含める
 *    (誕生日メールは重要度が低く、確認必須にはしない)。
 */
export async function listBirthdayRecipients(params: {
  year: number;
  month?: number;
  day?: number;
}): Promise<BirthdayRecipient[]> {
  const today = jstToday();
  const month = params.month ?? today.month;
  const day = params.day ?? today.day;

  // birthDate は @db.Date のため生 SQL で月日抽出したいところだが、
  // demo-prisma 互換・可搬性のため全件取得して JS 側でフィルタする。
  // 会員数が多くなった場合は raw SQL (EXTRACT) 版に置き換える。
  const users = await prisma.user.findMany({
    where: {
      birthDate: { not: null },
      deletedAt: null,
      bannedAt: null,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      preferredName: true,
      fullName: true,
      birthDate: true,
    },
  });

  const matched = users.filter((u) => {
    if (!u.birthDate) return false;
    const md = birthMonthDay(u.birthDate);
    return md.month === month && md.day === day;
  });

  if (matched.length === 0) return [];

  const deliveries = await prisma.birthdayMailDelivery.findMany({
    where: { year: params.year, userId: { in: matched.map((u) => u.id) } },
    select: { userId: true, sentAt: true, emailSent: true },
  });
  const byUser = new Map(deliveries.map((d) => [d.userId, d]));

  return matched
    .map((u) => {
      const d = byUser.get(u.id);
      return {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        preferredName: u.preferredName,
        fullName: u.fullName,
        birthDate: u.birthDate as Date,
        sent: Boolean(d),
        sentAt: d?.sentAt ?? null,
        emailSent: d?.emailSent ?? false,
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
}

// ---------------------------------------------------------------------------
// 送信
// ---------------------------------------------------------------------------

export type SendResult = {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: { userId: string; email: string; message: string }[];
};

/**
 * 指定年のテンプレートを、対象の会員へ送信する。
 *  - userIds を指定するとその会員のみ、省略すると「今日が誕生日で未送信」の全員。
 *  - 既に配信記録がある会員 (emailSent=true) はスキップ (二重送信防止)。
 *    記録はあるが送信失敗 (emailSent=false) の会員は再送を試みる。
 *  - 送信の成否に関わらず、成功時は配信記録を upsert する。
 */
export async function sendBirthdayMails(params: {
  year: number;
  userIds?: string[];
}): Promise<SendResult> {
  const { year } = params;
  const template = await getBirthdayTemplate(year);
  if (!template) {
    throw new Error(`${year} 年の誕生日メールテンプレートが未設定です。`);
  }
  if (!template.enabled) {
    throw new Error(`${year} 年のテンプレートは無効化されています。有効にしてから送信してください。`);
  }

  const today = jstToday();
  const recipients = await listBirthdayRecipients({ year });
  let targets = recipients;

  if (params.userIds && params.userIds.length > 0) {
    const set = new Set(params.userIds);
    targets = recipients.filter((r) => set.has(r.id));
  }

  const result: SendResult = {
    attempted: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const r of targets) {
    // 送信済み (実送信成功) はスキップ。失敗記録のみは再送を許可。
    if (r.sent && r.emailSent) {
      result.skipped++;
      continue;
    }
    result.attempted++;

    const name = resolveRecipientName(r);
    const subject = renderBirthdayMailText(template.subject, { name, year });
    const body = renderBirthdayMailText(template.body, { name, year });
    const html = buildBirthdayMailHtml({
      name,
      body,
      imageUrl: absoluteUrl(template.imageUrl),
      year,
    });
    const text = buildBirthdayMailText({ body, year });

    let emailSent = false;
    try {
      await sendEmail({ to: r.email, subject, text, html });
      emailSent = true;
      result.sent++;
    } catch (e) {
      result.failed++;
      result.errors.push({
        userId: r.id,
        email: r.email,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    // 配信記録を作成/更新 (送信失敗でも記録し、マイページ表示と再送判定に使う)。
    try {
      await prisma.birthdayMailDelivery.upsert({
        where: { userId_year: { userId: r.id, year } },
        create: {
          userId: r.id,
          year,
          templateId: template.id,
          subject,
          body,
          imageUrl: template.imageUrl,
          emailSent,
          sentAt: new Date(),
        },
        update: {
          templateId: template.id,
          subject,
          body,
          imageUrl: template.imageUrl,
          emailSent,
          sentAt: new Date(),
        },
      });
    } catch {
      // 記録に失敗しても送信自体の成否は上で計上済み。ログのみに留める。
    }
  }

  void today; // (将来: 送信ログに日付を残す用途)
  return result;
}

// ---------------------------------------------------------------------------
// マイページ用: 会員が受け取った誕生日メール
// ---------------------------------------------------------------------------

/** 会員が受け取った誕生日メール (新しい年順)。実送信できたものだけを見せる。 */
export async function listUserBirthdayMails(
  userId: string,
): Promise<BirthdayMailDelivery[]> {
  const rows = await prisma.birthdayMailDelivery.findMany({
    where: { userId, emailSent: true },
  });
  return [...rows].sort((a, b) => b.year - a.year);
}

/** 会員の未読の誕生日メール件数 (マイページのバッジ用)。 */
export async function countUnreadBirthdayMails(userId: string): Promise<number> {
  return prisma.birthdayMailDelivery.count({
    where: { userId, emailSent: true, readAt: null },
  });
}

/** 会員が誕生日メールを閲覧したら既読にする (本人のもののみ)。 */
export async function markBirthdayMailRead(params: {
  userId: string;
  deliveryId: string;
}): Promise<void> {
  await prisma.birthdayMailDelivery.updateMany({
    where: { id: params.deliveryId, userId: params.userId, readAt: null },
    data: { readAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// URL / メール HTML 生成
// ---------------------------------------------------------------------------

/** 相対URLを絶対URLに変換する (メール内の画像は絶対URLでなければ表示されない)。 */
function absoluteUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  const base = env.appBaseUrl.replace(/\/$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 誕生日メールのプレーンテキスト版。 */
export function buildBirthdayMailText(params: { body: string; year: number }): string {
  return (
    `${params.body}\n\n` +
    `――――――――――\n` +
    `ReiRieRoom | REIRIE 公式ファンクラブ\n` +
    `${env.appBaseUrl.replace(/\/$/, '')}/me`
  );
}

/**
 * 誕生日メールの HTML 版。少し凝った、お祝いらしいデザイン。
 *  - 紙吹雪・ケーキの絵文字と、ブランドのパープル系グラデーション。
 *  - 画像があればカード上部にヒーローとして表示。
 *  - 本文の改行は <br> に変換。
 */
export function buildBirthdayMailHtml(params: {
  name: string;
  body: string;
  imageUrl: string | null;
  year: number;
}): string {
  const safeBody = escapeHtml(params.body).replace(/\n/g, '<br>');
  const mypageUrl = `${env.appBaseUrl.replace(/\/$/, '')}/me`;
  // ヒーロー画像。読み込めなかった場合でも壊れた「?」アイコンや大きな空白が
  // 目立たないよう、alt を空にし、背景をブランドカラーで塗り、高さを抑える。
  const hero = params.imageUrl
    ? `<a href="${escapeHtml(mypageUrl)}" style="display:block;line-height:0;text-decoration:none;background:linear-gradient(135deg,#c263a2 0%,#a84f89 50%,#6a2f57 100%);"><img src="${escapeHtml(params.imageUrl)}" alt="" width="600" style="display:block;width:100%;max-width:100%;height:auto;max-height:340px;border:0;outline:none;-ms-interpolation-mode:bicubic;object-fit:cover;" /></a>`
    : '';

  // サイトのトンマナに合わせたヘッダー。
  //  - 絵文字は使わず、サイトと同じ「ReiRieRoom」ロゴタイプ（太字・字間広め）を主役に。
  //  - 装飾は上品なシンボル（✦ / 細いディバイダー）で、ブランドのマゼンタ〜ラベンダー基調。
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Happy Birthday</title></head>
<body style="margin:0;padding:0;background:#efeaf4;font-family:'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',sans-serif;color:#2b1522;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="border-radius:20px;overflow:hidden;box-shadow:0 12px 34px rgba(106,47,87,.18);background:#ffffff;">
      ${hero}
      <div style="background:linear-gradient(135deg,#c263a2 0%,#a84f89 52%,#6a2f57 100%);padding:${hero ? '26px' : '44px'} 24px 30px;text-align:center;">
        <div style="font-size:16px;font-weight:900;letter-spacing:.22em;color:#ffffff;padding-left:.22em;">
          ReiRieRoom
        </div>
        <div style="margin:12px auto 0;width:44px;height:2px;background:rgba(255,255,255,.55);border-radius:2px;"></div>
        <div style="margin:16px 0 4px;color:#f3d9ea;font-size:12px;letter-spacing:.3em;padding-left:.3em;">&#10022; HAPPY BIRTHDAY &#10022;</div>
        <h1 style="margin:6px 0 0;color:#ffffff;font-size:26px;letter-spacing:.04em;font-weight:900;line-height:1.35;">
          お誕生日<br style="display:none">おめでとうございます
        </h1>
        <p style="margin:12px 0 0;color:#f6e5f0;font-size:14px;font-weight:700;letter-spacing:.02em;">
          ${escapeHtml(params.name)} さんへ
        </p>
      </div>
      <div style="padding:30px 28px 8px;">
        <p style="margin:0 0 20px;font-size:15px;line-height:1.95;color:#3a1c2d;">
          ${safeBody}
        </p>
        <div style="text-align:center;margin:28px 0 22px;">
          <a href="${escapeHtml(mypageUrl)}"
             style="display:inline-block;background:linear-gradient(135deg,#c263a2,#a84f89);color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;letter-spacing:.04em;padding:14px 34px;border-radius:999px;box-shadow:0 6px 16px rgba(168,79,137,.38);">
            マイページで見る &#8594;
          </a>
        </div>
      </div>
      <div style="border-top:1px solid #f0e2ec;padding:20px 26px 26px;text-align:center;">
        <div style="font-size:12px;font-weight:900;letter-spacing:.28em;color:#a84f89;padding-left:.28em;">ReiRieRoom</div>
        <p style="margin:8px 0 0;font-size:11px;color:#b09bab;line-height:1.8;">
          REIRIE 公式ファンクラブ<br>
          このメールは会員のみなさまの誕生日にお送りしています &#183; ${params.year}
        </p>
      </div>
    </div>
  </div>
</body></html>`;
}
