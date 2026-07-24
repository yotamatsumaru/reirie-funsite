/**
 * POST /api/super-admin/users/create-fan
 *   - SUPER_ADMIN 限定: ファンユーザーを管理画面から直接登録する。
 *
 * 通常のフローは会員自身が /signup でメール認証を経て登録するが、
 * 記念会員番号 (例: RR-000000) の割り当てなど、運営が意図的に
 * 特定のメール・会員番号でアカウントを作成したいケースに対応する。
 *
 *  - 会員番号を明示指定できる (未指定なら MemberCounter から自動採番)。
 *  - メール認証は不要 (emailVerified を即時セットする)。
 *  - パスワード省略時はランダム生成し、レスポンスで一度だけ返す
 *    (運営が本人へ別途安全な手段で伝える想定)。
 */
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { prisma, Prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/password';
import { AdminCreateFanUserSchema } from '@idol/shared';

export const runtime = 'nodejs';

function isUniqueViolation(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** target の一意制約カラム名を人が読める形にする */
function uniqueFieldLabel(e: Prisma.PrismaClientKnownRequestError): string {
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');
  if (fields.includes('member_number')) return '会員番号';
  if (fields.includes('email')) return 'メールアドレス';
  return '入力値';
}

/** 8文字のランダムな英数字パスワードを生成する (大文字/小文字/数字を各1つ以上含む) */
function generateRandomPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const all = upper + lower + digit;
  const pick = (chars: string) => chars[randomBytes(1)[0] % chars.length];
  const rest = Array.from({ length: 9 }, () => pick(all)).join('');
  return `${pick(upper)}${pick(lower)}${pick(digit)}${rest}`;
}

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = AdminCreateFanUserSchema.safeParse(body);
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }
  const { email, displayName, memberNumber, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw errors.conflict('このメールアドレスは既に登録されています');
  }

  const plainPassword = password ?? generateRandomPassword();
  const generated = !password;

  try {
    const user = await prisma.user.create({
      data: {
        email,
        displayName: displayName ?? null,
        passwordHash: hashPassword(plainPassword),
        // 管理画面からの直接登録は運営が本人確認済みのため、メール認証を即時完了とする。
        emailVerified: new Date(),
        // 未指定なら null (通常の自動採番 (ensureMemberNumber) が後から付与する)。
        memberNumber: memberNumber ?? null,
      },
      select: { id: true, email: true, displayName: true, memberNumber: true, createdAt: true },
    });

    await logAudit({
      userId: session.user.id,
      action: 'user.create_by_admin',
      resource: `user:${user.id}`,
      metadata: { email, memberNumber: user.memberNumber, passwordGenerated: generated },
    });

    return NextResponse.json({
      ok: true,
      user,
      // 生成したパスワードはこのレスポンスでのみ返す (DB には平文を保存しない)。
      ...(generated ? { generatedPassword: plainPassword } : {}),
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw errors.conflict(`この${uniqueFieldLabel(e)}は既に使用されています`);
    }
    throw e;
  }
});
