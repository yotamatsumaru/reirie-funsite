import { z } from 'zod';
import { PLAN_TYPES, BILLING_INTERVALS } from '../constants';

export const CreateCheckoutSessionSchema = z.object({
  plan: z.enum(['STANDARD', 'PREMIUM']),
  interval: z.enum(BILLING_INTERVALS),
  successUrl: z.url(),
  cancelUrl: z.url(),
});
export type CreateCheckoutSessionInput = z.infer<typeof CreateCheckoutSessionSchema>;

/**
 * プラン変更 (予約) リクエスト。
 *
 * 契約期間中のアップグレード / ダウングレードは即時切替せず、
 * 「期間満了時に切り替える」予約として受け付ける (Stripe Subscription Schedule)。
 * 各プランの課金サイクルは固定 (STANDARD=月額 / PREMIUM=年額) のため
 * interval は任意 (省略時はプラン既定を採用)。
 */
export const ChangePlanSchema = z.object({
  plan: z.enum(['STANDARD', 'PREMIUM']),
  interval: z.enum(BILLING_INTERVALS).optional(),
});
export type ChangePlanInput = z.infer<typeof ChangePlanSchema>;

export const CancelSubscriptionSchema = z.object({
  cancelAtPeriodEnd: z.boolean().default(true),
});
export type CancelSubscriptionInput = z.infer<typeof CancelSubscriptionSchema>;

export const SubscriptionResponseSchema = z.object({
  id: z.uuid(),
  plan: z.enum(PLAN_TYPES),
  interval: z.enum(BILLING_INTERVALS),
  status: z.string(),
  currentPeriodStart: z.iso.datetime(),
  currentPeriodEnd: z.iso.datetime(),
  cancelAtPeriodEnd: z.boolean(),
});

/**
 * 管理画面 (SUPER_ADMIN) からの 1ユーザー分サブスク操作。
 *   - action='sync'  : この顧客の Stripe サブスクを取得して DB を修復する
 *                       (決済成功後に押せば INCOMPLETE → ACTIVE に直る)。
 *   - action='grant' : Stripe を介さず DB に有料プランを手動付与する
 *                       (コンプ/サポート対応)。months で有効期間 (月数) を指定可。
 */
export const AdminUserSubscriptionActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync') }),
  z.object({
    action: z.literal('grant'),
    plan: z.enum(['STANDARD', 'PREMIUM']),
    interval: z.enum(BILLING_INTERVALS),
    months: z.number().int().min(1).max(60).optional(),
  }),
]);
export type AdminUserSubscriptionActionInput = z.infer<
  typeof AdminUserSubscriptionActionSchema
>;
