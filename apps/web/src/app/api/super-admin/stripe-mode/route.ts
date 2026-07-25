/**
 * GET   /api/super-admin/stripe-mode — Stripe 運用モード (LIVE/TEST) とテスト資格情報を取得
 * PATCH /api/super-admin/stripe-mode — 運用モードとテスト資格情報を更新 (即時反映)
 *
 * SUPER_ADMIN 限定。値は AppSetting (stripe.mode / stripe.testCredentials) に永続化される。
 *
 * 対象は Web アプリの Checkout / Billing Portal / Webhook (/api/game/webhook) のみ。
 * 独立稼働の Stripe Webhook Lambda (functions/stripe-webhook) は対象外
 * (EC2 障害時のフェイルセーフ用に本番キー固定で稼働させる設計のため)。
 */
import { NextResponse } from 'next/server';
import {
  StripeModeSchema,
  StripeTestCredentialsSchema,
  isStripeTestCredentialsUsable,
} from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  getStripeMode,
  setStripeMode,
  getStripeTestCredentials,
  setStripeTestCredentials,
} from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const mode = await getStripeMode();
  const testCredentials = await getStripeTestCredentials();
  return NextResponse.json({
    mode,
    testCredentials,
    testCredentialsUsable: isStripeTestCredentialsUsable(testCredentials),
  });
});

const PatchSchema = StripeTestCredentialsSchema.partial().extend({
  mode: StripeModeSchema.optional(),
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です');
  }
  const { mode, ...credInput } = parsed.data;

  const prevMode = await getStripeMode();
  const prevCredentials = await getStripeTestCredentials();

  // テスト資格情報が入力されている場合は更新する (未入力フィールドは既存値を維持)
  const hasCredInput = Object.keys(credInput).length > 0;
  let nextCredentials = prevCredentials;
  if (hasCredInput) {
    const merged = StripeTestCredentialsSchema.safeParse({ ...prevCredentials, ...credInput });
    if (!merged.success) {
      throw errors.unprocessable('テスト資格情報の入力値が不正です');
    }
    nextCredentials = await setStripeTestCredentials(merged.data);
  }

  let nextMode = prevMode;
  if (mode !== undefined) {
    if (mode === 'TEST' && !isStripeTestCredentialsUsable(nextCredentials)) {
      throw errors.badRequest(
        'テストモードに切り替えるには、Secret Key と Webhook Secret を先に設定してください',
      );
    }
    nextMode = await setStripeMode(mode);
  }

  await logAudit({
    userId: session.user.id,
    action: 'setting.stripe_mode_update',
    resource: 'setting:stripe.mode',
    metadata: {
      from: { mode: prevMode, hasTestSecretKey: !!prevCredentials.secretKey },
      to: { mode: nextMode, hasTestSecretKey: !!nextCredentials.secretKey },
    },
  });

  return NextResponse.json({
    mode: nextMode,
    testCredentials: nextCredentials,
    testCredentialsUsable: isStripeTestCredentialsUsable(nextCredentials),
  });
});
