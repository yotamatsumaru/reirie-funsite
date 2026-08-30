/**
 * PATCH /api/super-admin/users/[id]/email — 運営が会員のメールアドレスを変更する
 *
 * 【なぜ運営側にも必要なのか】
 * 会員本人による変更 (/api/me/email) は「新アドレス宛の確認コード」を必須にしている。
 * しかし実際の問い合わせでは、
 *   - 旧アドレスのメールサービスを解約済みで、そもそもログインできない
 *   - キャリアメールが受信拒否設定で確認コードが届かない
 * といった、本人が自力では手続きを完了できないケースがある。
 * (お問い合わせ「登録のメールアドレス変えたい」はまさにこの形で届く)
 * その最後の受け皿として、運営が代行できる導線を用意する。
 *
 * 【本人の導線とあえて違えている点】
 *  - 確認コードを送らない: 本人がメールを受け取れない状況を救うための機能なので、
 *    コード確認を必須にすると本来の目的を果たせない。
 *  - 代わりに SUPER_ADMIN 限定 + 監査ログ + 旧アドレスへの通知で担保する。
 *    「誰が・いつ・どのアカウントを・どのアドレスに変えたか」を必ず追えるようにする。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, Prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { isSameEmail, maskEmail, normalizeEmailForComparison } from '@idol/shared';
import { sendEmailChangedNoticeEmail } from '@/lib/email';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  newEmail: z.email('メールアドレスの形式が正しくありません'),
  /** 変更理由 (問い合わせ番号など)。後から経緯を追えるよう監査ログに残す。 */
  reason: z.string().trim().max(500).optional(),
});

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;

    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
    }
    const newEmail = normalizeEmailForComparison(parsed.data.newEmail);

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, deletedAt: true },
    });
    if (!target) throw errors.notFound('ユーザーが見つかりません');

    if (isSameEmail(target.email, newEmail)) {
      throw errors.badRequest('現在のメールアドレスと同じです');
    }

    const taken = await prisma.user.findUnique({
      where: { email: newEmail },
      select: { id: true },
    });
    if (taken && taken.id !== id) {
      throw errors.conflict('このメールアドレスは既に他の会員が使用しています');
    }

    const previousEmail = target.email;

    try {
      await prisma.user.update({
        where: { id },
        data: {
          email: newEmail,
          // 運営が本人確認のうえ変更しているため認証済みとして扱う。
          // ここを null にすると、変更した途端に本人がログインできなくなる
          // (credentials.ts が !emailVerified を弾くため)。
          emailVerified: new Date(),
          // 本人が申請中だった手続きは、運営の変更で意味を失うのでクリアする。
          pendingEmail: null,
          pendingEmailCode: null,
          pendingEmailExpires: null,
          pendingEmailAttempts: 0,
        },
      });
    } catch (e) {
      // citext の一意制約による最終防衛線 (上のチェックとの競合を捕まえる)。
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw errors.conflict('このメールアドレスは既に他の会員が使用しています');
      }
      throw e;
    }

    await logAudit({
      userId: session.user.id,
      action: 'user.email_change.admin',
      resource: `user:${id}`,
      metadata: {
        targetUserId: id,
        // 監査ログに平文のアドレスを残さない (ログ閲覧者に個人情報を広げないため)。
        from: maskEmail(previousEmail),
        to: maskEmail(newEmail),
        reason: parsed.data.reason ?? null,
      },
    });

    // 旧アドレスへ通知する。運営操作であっても、本人が身に覚えのない変更に
    // 気づけるようにしておく (第三者のなりすまし依頼への抑止にもなる)。
    // 旧アドレスが受信不能なケースが前提の機能なので、失敗しても処理は止めない。
    let noticeSent = true;
    try {
      await sendEmailChangedNoticeEmail({
        to: previousEmail,
        displayName: target.displayName ?? '',
        maskedNewEmail: maskEmail(newEmail),
      });
    } catch (err) {
      noticeSent = false;
      // eslint-disable-next-line no-console
      console.error('[admin email change] failed to notify previous address', err);
    }

    return NextResponse.json({
      ok: true,
      email: newEmail,
      noticeSent,
    });
  },
);
