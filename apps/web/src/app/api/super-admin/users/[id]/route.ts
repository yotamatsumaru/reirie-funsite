/**
 * PATCH  /api/super-admin/users/[id]
 *   - SUPER_ADMIN 限定: ロール変更 / BAN / 復活
 *
 * body 例:
 *   { role: 'ADMIN' | 'USER' | 'SUPER_ADMIN' }
 *   { banned: true, banReason: '規約違反のため' }
 *   { banned: false }
 *   { promoUntil: '2026-08-01T00:00:00.000Z' }  … プロモ/デモを付与 (期限付き)
 *   { promoUntil: null }                         … プロモ/デモを解除
 *
 * DELETE /api/super-admin/users/[id]
 *   - SUPER_ADMIN 限定: BAN 済みユーザーの完全消去
 *   - 注文/決済など会計記録として残す必要があるレコードが紐づく場合は
 *     物理削除できないため、個人情報を匿名化した上でログイン不可の状態にする。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, Prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { USER_ROLES } from '@idol/shared';
import { safeGetPromoUntil, safeSetPromoUntil } from '@/lib/points';

export const runtime = 'nodejs';

const PatchSchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    banned: z.boolean().optional(),
    // BAN 実行時の理由 (任意入力だが、ゴミ箱 UI での確認用に保存する)
    banReason: z.string().trim().max(1000).optional(),
    // プロモ/デモアカウントの有効期限。
    //  - ISO 日時文字列 … その日時までプロモ有効 (ミニゲーム回数無制限 + 勝率PREMIUM相当)
    //  - null            … プロモ解除 (通常アカウントに戻す)
    promoUntil: z.string().datetime().nullable().optional(),
  })
  .refine(
    (v) =>
      v.role !== undefined || v.banned !== undefined || v.promoUntil !== undefined,
    {
      message: 'role / banned / promoUntil のいずれかを指定してください',
    },
  );

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;

    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
    }
    const { role, banned, banReason, promoUntil } = parsed.data;

    // 自分自身のロール降格・BAN は禁止 (安全装置)
    if (id === session.user.id) {
      if (role && role !== 'SUPER_ADMIN') {
        throw errors.badRequest('自分自身のロールは変更できません');
      }
      if (banned === true) {
        throw errors.badRequest('自分自身を BAN することはできません');
      }
    }

    // promo_until は Prisma モデルに載せていない (カラム未適用の DB で全 user 操作が
    // 壊れるのを防ぐため) ので、select を明示して取得する。
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!target) throw errors.notFound('ユーザーが見つかりません');

    const updateData: Record<string, unknown> = {};
    const auditMeta: Record<string, unknown> = { targetUserId: id };

    if (role && role !== target.role) {
      updateData.role = role;
      auditMeta.role = { from: target.role, to: role };
    }
    if (banned === true && !target.deletedAt) {
      const now = new Date();
      updateData.deletedAt = now;
      // 運営による BAN であることを区別するため bannedAt/banReason も記録する。
      // (deletedAt は自己都合の退会でも使われる共通フィールドのため)
      updateData.bannedAt = now;
      updateData.banReason = banReason && banReason.length > 0 ? banReason : null;
      auditMeta.banned = true;
      auditMeta.banReason = updateData.banReason;
    }
    if (banned === false && target.deletedAt) {
      updateData.deletedAt = null;
      // bannedAt/banReason はクリアしない (ゴミ箱 UI で直近の BAN 理由を
      // 履歴として確認できるようにするため、意図的に残す)
      auditMeta.restored = true;
    }
    // プロモ/デモアカウントの付与・解除。
    // promo_until は Prisma モデル外 (生 SQL) のため、prisma.user.update ではなく
    // safeSetPromoUntil で別途書き込む。カラム未適用なら false が返る。
    let promoChanged = false;
    let promoNext: Date | null = null;
    let promoMigrationMissing = false;
    if (promoUntil !== undefined) {
      const next = promoUntil ? new Date(promoUntil) : null;
      const prev = await safeGetPromoUntil(prisma, id);
      const prevIso = prev ? prev.toISOString() : null;
      const nextIso = next ? next.toISOString() : null;
      if (prevIso !== nextIso) {
        promoNext = next;
        auditMeta.promoUntil = { from: prevIso, to: nextIso };
        promoChanged = true;
      }
    }

    if (Object.keys(updateData).length === 0 && !promoChanged) {
      return NextResponse.json({ ok: true, noChange: true });
    }

    // 通常フィールド (role / banned 等) の更新。select を明示して promo_until を
    // RETURNING に含めない (カラム未適用でも壊れないようにする)。
    let updatedRole = target.role;
    if (Object.keys(updateData).length > 0) {
      const updated = await prisma.user.update({
        where: { id },
        data: updateData,
        select: { id: true, role: true },
      });
      updatedRole = updated.role;
    }

    // プロモ/デモの書き込み (生 SQL)。カラム未適用なら false。
    if (promoChanged) {
      const ok = await safeSetPromoUntil(prisma, id, promoNext);
      if (!ok) {
        promoMigrationMissing = true;
        promoChanged = false;
      }
    }

    await logAudit({
      userId: session.user.id,
      action:
        banned === true
          ? 'user.ban'
          : banned === false
            ? 'user.restore'
            : promoChanged
              ? 'user.promo.update'
              : 'user.role.update',
      resource: `user:${id}`,
      metadata: auditMeta,
    });

    return NextResponse.json({
      ok: true,
      // promo_until カラムが未適用でプロモ書き込みだけができなかった場合に通知する。
      ...(promoMigrationMissing
        ? {
            promoMigrationMissing: true,
            message:
              'promo_until カラムが未適用のため、プロモ設定は保存できませんでした。DB マイグレーションを適用してください。',
          }
        : {}),
      user: {
        id,
        role: updatedRole,
        promoUntil: promoChanged ? (promoNext ? promoNext.toISOString() : null) : undefined,
      },
    });
  },
);

function isForeignKeyRestriction(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';
}

/** 匿名化後に埋める、他ユーザーと衝突しないダミー値 */
function anonymizedEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`;
}

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;

    if (id === session.user.id) {
      throw errors.badRequest('自分自身のアカウントは消去できません');
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, deletedAt: true, role: true },
    });
    if (!target) throw errors.notFound('ユーザーが見つかりません');

    // 誤操作防止: 先に BAN (deletedAt が入っている状態) されていることを必須とする。
    if (!target.deletedAt) {
      throw errors.badRequest(
        '完全消去は BAN 済みのユーザーのみ実行できます。先に BAN してください。',
      );
    }

    // まずは物理削除を試みる。注文・決済など会計記録として残す必要がある
    // レコードが紐づいている場合は外部キー制約 (RESTRICT) で失敗する。
    try {
      await prisma.user.delete({ where: { id } });
      await logAudit({
        userId: session.user.id,
        action: 'user.erase.hard',
        resource: `user:${id}`,
        metadata: { targetUserId: id, email: target.email },
      });
      return NextResponse.json({ ok: true, mode: 'hard_delete' });
    } catch (e) {
      if (!isForeignKeyRestriction(e)) throw e;
    }

    // 物理削除できない場合は、個人情報を匿名化してログイン不可の状態にする
    // (注文/決済などの会計記録自体は保持し、紐づく本人情報のみ消去する)。
    await prisma.user.update({
      where: { id },
      data: {
        email: anonymizedEmail(id),
        passwordHash: null,
        displayName: null,
        fullName: null,
        furigana: null,
        phone: null,
        birthDate: null,
        postalCode: null,
        prefecture: null,
        addressLine1: null,
        addressLine2: null,
        avatarUrl: null,
        preferredName: null,
        marketingOptIn: false,
        stripeCustomerId: null,
        verificationToken: null,
        verificationCode: null,
        verificationCodeExpires: null,
        passwordResetToken: null,
        passwordResetExpires: null,
        totpSecret: null,
        totpEnabled: false,
        totpVerifiedAt: null,
        totpBackupCodes: [],
      },
    });
    await logAudit({
      userId: session.user.id,
      action: 'user.erase.anonymize',
      resource: `user:${id}`,
      metadata: {
        targetUserId: id,
        originalEmail: target.email,
        reason: '注文/決済など会計記録が紐づくため物理削除不可。個人情報を匿名化しました。',
      },
    });
    return NextResponse.json({ ok: true, mode: 'anonymized' });
  },
);
