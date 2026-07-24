/**
 * POST /api/super-admin/users/set-member-number
 *   - SUPER_ADMIN 限定: 既存ユーザー (メールアドレス指定) の会員番号を直接変更する。
 *
 * 通常のファン新規登録 (create-fan) は「メールアドレスが既に登録されている」場合
 * 使えないため、運営スタッフ本人 (SUPER_ADMIN 等、すでにアカウントを持つ人) に
 * 記念会員番号を割り当てたい場合はこちらを使う。
 *
 * body 例:
 *   { email: 'foo@example.com', memberNumber: 'RR-000001' }
 *   { email: 'foo@example.com', memberNumber: null }  … 会員番号を未設定に戻す
 */
import { NextResponse } from 'next/server';
import { prisma, Prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { AdminSetMemberNumberSchema } from '@idol/shared';

export const runtime = 'nodejs';

function isUniqueViolation(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = AdminSetMemberNumberSchema.safeParse(body);
  if (!parsed.success) throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  const { email, memberNumber } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, displayName: true, memberNumber: true, role: true },
  });
  if (!target) throw errors.notFound('指定のメールアドレスのユーザーが見つかりません');

  if (target.memberNumber === memberNumber) {
    return NextResponse.json({ ok: true, noChange: true, user: target });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { memberNumber },
      select: { id: true, email: true, displayName: true, memberNumber: true },
    });
    await logAudit({
      userId: session.user.id,
      action: 'user.member_number.update',
      resource: `user:${target.id}`,
      metadata: {
        targetUserId: target.id,
        email,
        memberNumber: { from: target.memberNumber, to: memberNumber },
      },
    });
    return NextResponse.json({ ok: true, user: updated });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw errors.conflict('この会員番号は既に他のユーザーに使用されています');
    }
    throw e;
  }
});
