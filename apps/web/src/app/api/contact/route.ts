/**
 * POST /api/contact — お問い合わせフォームの送信 (公開エンドポイント)
 *
 * - ログイン不要 (ゲストからの問い合わせも受け付ける)。
 * - ログイン中の場合は userId を紐づけて保存する。
 * - 濫用対策として、同一メールアドレスからの短時間の連投を簡易的に制限する。
 * - 保存後は管理画面 (/super-admin/contact) で確認できる。
 *
 * 【控えメール / 運営通知 (2026-09 追加)】
 * 会員様から「送った内容のコピーをメールで送ってほしい。届いているのか
 * 分からない」というご要望をいただき、受付番号つきの控えメールを
 * 送信者本人へ送るようにした。あわせて、新規問い合わせが運営に気づかれず
 * 2 週間放置された事例への対策として、運営宛の受信通知も送る。
 *
 * ★重要: メール送信の失敗で問い合わせを失わせない。
 *   ContactMessage レコードが唯一の正であり、メールは付随物。
 *   sendContactNotifications() は例外を投げず結果を返す設計なので、
 *   SES 障害時も 201 を返し「受け付けた」状態を維持する。
 *   レスポンスの ackMailSent で控えが送れたかをフォームに伝え、
 *   完了画面の案内文を出し分ける (届かない場合の説明を出す)。
 */
import { NextResponse } from 'next/server';
import { prisma, Prisma } from '@idol/db';
import { ContactSubmitSchema, generateContactTicketNumber } from '@idol/shared';
import { auth } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { sendContactNotifications } from '@/lib/contact-notify';

export const runtime = 'nodejs';

// 同一メールアドレスからの連投を制限する間隔 (秒)
const CONTACT_COOLDOWN_SECONDS = 30;
// 同一メールアドレスからの直近1時間あたりの上限件数
const CONTACT_HOURLY_LIMIT = 5;
/**
 * 受付番号が既存と衝突した場合の再生成回数。
 * ランダム部は 32^5 ≈ 3355 万通りあるため実際にはまず衝突しないが、
 * 万一衝突しても問い合わせを落とさないようリトライする。
 */
const TICKET_RETRY = 5;

/** 送信元 IP を取得 (プロキシ経由の x-forwarded-for を優先) */
function getClientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip');
}

/** 受付番号の一意制約違反 (P2002) かどうか */
function isTicketConflict(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === 'P2002' &&
    JSON.stringify(e.meta ?? {}).includes('ticket_number')
  );
}

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const input = ContactSubmitSchema.parse(body);

  // 簡易レート制限: 同一メールの直近送信をチェック。
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.contactMessage.findMany({
    where: { email: input.email, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (recent.length >= CONTACT_HOURLY_LIMIT) {
    throw errors.rateLimited(
      'お問い合わせの送信回数が上限に達しました。しばらく時間をおいてから再度お試しください。',
    );
  }
  if (recent[0]) {
    const elapsed = (Date.now() - recent[0].createdAt.getTime()) / 1000;
    if (elapsed < CONTACT_COOLDOWN_SECONDS) {
      throw errors.rateLimited('送信間隔が短すぎます。少し時間をおいてから再度お試しください。');
    }
  }

  // ログイン中なら userId を紐づける (任意)。
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const baseData = {
    name: input.name,
    email: input.email,
    category: input.category,
    subject: input.subject,
    message: input.message,
    userId,
    ipAddress: getClientIp(req) ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  };

  // 受付番号つきで保存 (衝突時のみ番号を振り直して再試行)。
  let created: {
    id: string;
    ticketNumber: string | null;
    createdAt: Date;
    user: { memberNumber: string | null } | null;
  } | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < TICKET_RETRY; attempt += 1) {
    try {
      created = await prisma.contactMessage.create({
        data: { ...baseData, ticketNumber: generateContactTicketNumber() },
        select: {
          id: true,
          ticketNumber: true,
          createdAt: true,
          user: { select: { memberNumber: true } },
        },
      });
      break;
    } catch (e) {
      lastError = e;
      if (!isTicketConflict(e)) throw e;
      // 衝突 → 次のループで新しい番号を生成して再試行
    }
  }
  if (!created) {
    // ここに来るのは 5 回連続で番号が衝突した場合のみ (現実的にはほぼ起こらない)。
    throw lastError instanceof Error
      ? lastError
      : errors.internal('お問い合わせの受付に失敗しました。時間をおいて再度お試しください。');
  }

  // 控えメール & 運営通知。この関数は例外を投げないため、
  // メール障害でも下の 201 レスポンスは必ず返る (＝問い合わせは成立する)。
  const notify = await sendContactNotifications({
    id: created.id,
    ticketNumber: created.ticketNumber ?? '',
    name: input.name,
    email: input.email,
    category: input.category,
    subject: input.subject,
    message: input.message,
    createdAt: created.createdAt,
    isMember: Boolean(userId),
    memberNumber: created.user?.memberNumber ?? null,
  });

  return NextResponse.json(
    {
      ok: true,
      id: created.id,
      ticketNumber: created.ticketNumber,
      // フォームの完了画面で「控えメールを送りました」の案内を出し分けるために返す。
      // 運営通知の成否は会員に関係しないため返さない (管理画面で確認する)。
      ackMailSent: notify.ackMailSent,
    },
    { status: 201 },
  );
});
