/**
 * GET /api/super-admin/subscriptions/health
 *   プラン反映の不整合（決済済みなのに無料プラン扱い等）を検知して返す。
 *
 * ## 背景
 *   会員から「プレミアムプランに加入したのに無料プランのまま。
 *   購入履歴には支払い成功と出ている」という申告が発生した。
 *
 *   原因は Webhook がユーザーを特定できず Subscription 行が作られなかったこと。
 *   従来はこの状態を検知する手段が無く、会員の申告を待つしかなかった。
 *   本エンドポイントは運営が能動的に発見できるようにするためのもの。
 *
 * ## 権限
 *   参照のみのため requireSuperAdminView（STAFF も閲覧可）。
 *   実際の復旧操作は既存の sync / grant / reconcile（SUPER_ADMIN 限定）で行う。
 */
import { NextResponse } from 'next/server';
import { requireSuperAdminView } from '@/auth';
import { handle } from '@/lib/errors';
import { buildSubscriptionHealthReport } from '@/lib/subscription-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const report = await buildSubscriptionHealthReport();
  return NextResponse.json({ ok: true, ...report });
});
