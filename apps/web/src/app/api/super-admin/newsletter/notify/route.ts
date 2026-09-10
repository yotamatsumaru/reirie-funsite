/**
 * POST /api/super-admin/newsletter/notify
 *   会報誌に関する一斉メールを送信する (SUPER_ADMIN 限定)
 *
 *   kind = 'ADDRESS_REMINDER' … 住所未記入の会員へ «ご登録のお願い»
 *   kind = 'SHIPPING_NOTICE'  … 発送完了のお知らせ
 *
 * 【SUPER_ADMIN 限定にしている理由】
 * 実在の会員全員へメールを送る操作であり、取り消せない。
 * CSV エクスポート (個人情報の持ち出し) と同じ重みの操作として扱う。
 *
 * 【二重送信の防止】
 * NewsletterMailLog の UNIQUE (issueKey, kind, userId) で DB レベルで防ぐ。
 * 同じ号に対して 2 回実行しても、2 回目は skippedAlreadySent になる。
 * そのため «二度押ししても会員には 1 通しか届かない»。
 *
 * GET /api/super-admin/newsletter/notify?issueKey=... で送信状況を取得できる。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  getNewsletterMailStatus,
  sendAddressReminders,
  sendShippingNotices,
} from '@/lib/newsletter-mail';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

const BodySchema = z.object({
  kind: z.enum(['ADDRESS_REMINDER', 'SHIPPING_NOTICE']),
  /** 号を識別するキー。二重送信防止の単位になるため必須 */
  issueKey: z
    .string()
    .trim()
    .min(1, '号のキーを入力してください')
    .max(64)
    // ログ・URL に載るので安全な文字だけに限定する
    .regex(/^[A-Za-z0-9._-]+$/, '英数字・ハイフン・アンダースコアのみ使用できます'),
  /** 会員に見せる号の表示名 (例: 「2026年 春号」) */
  issueLabel: z.string().trim().min(1, '号の表示名を入力してください').max(60),
  /** ADDRESS_REMINDER: 登録期限の表示 (任意) */
  deadlineLabel: z.string().trim().max(60).optional(),
  /** SHIPPING_NOTICE: 発送日の表示 (任意。既定は今日) */
  shippedOnLabel: z.string().trim().max(60).optional(),
  /** SHIPPING_NOTICE: 到着目安 (任意) */
  arrivalLabel: z.string().trim().max(60).optional(),
  /** SHIPPING_NOTICE: 補足メッセージ (任意) */
  note: z.string().trim().max(500).optional(),
});

/** 今日を「2026年3月10日」形式 (JST) で表す */
function todayJstLabel(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;
}

export const GET = handle(async (req: Request) => {
  await requireSuperAdminView();
  const url = new URL(req.url);
  const issueKey = url.searchParams.get('issueKey')?.trim();
  if (!issueKey) throw errors.badRequest('issueKey が必要です');
  const status = await getNewsletterMailStatus(issueKey);
  return NextResponse.json({ issueKey, status }, { headers: { 'Cache-Control': 'no-store' } });
});

export const POST = handle(async (req: Request) => {
  // 送信は «閲覧» ではなく実行操作なので requireSuperAdmin (書き込み権限) を使う
  const session = await requireSuperAdmin();

  const body = BodySchema.parse(await req.json());

  // プロフィール編集ページの絶対 URL。
  // メール本文に載るため、相対パスでは踏めない。
  const profileUrl = `${env.appBaseUrl.replace(/\/$/, '')}/me`;

  const result =
    body.kind === 'ADDRESS_REMINDER'
      ? await sendAddressReminders({
          issueKey: body.issueKey,
          issueLabel: body.issueLabel,
          profileUrl,
          deadlineLabel: body.deadlineLabel,
        })
      : await sendShippingNotices({
          issueKey: body.issueKey,
          issueLabel: body.issueLabel,
          shippedOnLabel: body.shippedOnLabel || todayJstLabel(),
          arrivalLabel: body.arrivalLabel,
          note: body.note,
        });

  await logAudit({
    userId: session.user.id,
    action:
      body.kind === 'ADDRESS_REMINDER'
        ? 'newsletter.address_reminder'
        : 'newsletter.shipping_notice',
    resource: 'newsletter_mail_logs',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: {
      issueKey: body.issueKey,
      issueLabel: body.issueLabel,
      ...result,
      // エラー詳細は監査ログに入れすぎない (件数だけ)
      errors: result.errors.length,
    },
  });

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
});
