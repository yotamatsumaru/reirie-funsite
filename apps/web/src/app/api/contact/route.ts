/**
 * POST /api/contact — お問い合わせフォームの送信 (公開エンドポイント)
 *
 * - ログイン不要 (ゲストからの問い合わせも受け付ける)。
 * - ログイン中の場合は userId を紐づけて保存する。
 * - 濫用対策として、同一メールアドレスからの短時間の連投を簡易的に制限する。
 * - 保存後は管理画面 (/super-admin/contact) で確認できる。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ContactSubmitSchema } from '@idol/shared';
import { auth } from '@/auth';
import { handle, errors } from '@/lib/errors';

export const runtime = 'nodejs';

// 同一メールアドレスからの連投を制限する間隔 (秒)
const CONTACT_COOLDOWN_SECONDS = 30;
// 同一メールアドレスからの直近1時間あたりの上限件数
const CONTACT_HOURLY_LIMIT = 5;

/** 送信元 IP を取得 (プロキシ経由の x-forwarded-for を優先) */
function getClientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip');
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

  const created = await prisma.contactMessage.create({
    data: {
      name: input.name,
      email: input.email,
      category: input.category,
      subject: input.subject,
      message: input.message,
      userId,
      ipAddress: getClientIp(req) ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
});
