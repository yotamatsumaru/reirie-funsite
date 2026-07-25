/**
 * GET   /api/super-admin/member-ranks — 会員ランクの昇格条件 (しきい値) を取得
 * PATCH /api/super-admin/member-ranks — 昇格条件を更新 (永続化)
 *
 * SUPER_ADMIN 限定。値は AppSetting (membership.rankTiers) に JSON で永続化される。
 * 昇格条件はファンには非公開 (このエンドポイントは管理者専用)。
 */
import { NextResponse } from 'next/server';
import { MemberRankTiersSchema } from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getMemberRankTiers, setMemberRankTiers } from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const tiers = await getMemberRankTiers();
  return NextResponse.json({ tiers });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = MemberRankTiersSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です (各しきい値は 0 以上の整数で指定してください)');
  }

  const prev = await getMemberRankTiers();
  const next = await setMemberRankTiers(parsed.data);

  await logAudit({
    userId: session.user.id,
    action: 'setting.member_rank_tiers_update',
    resource: 'setting:membership.rankTiers',
    metadata: { from: prev, to: next },
  });

  return NextResponse.json({ ok: true, tiers: next });
});
