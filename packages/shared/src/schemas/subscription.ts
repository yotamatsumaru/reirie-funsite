import { z } from 'zod';
import { PLAN_TYPES, BILLING_INTERVALS } from '../constants';

export const CreateCheckoutSessionSchema = z.object({
  plan: z.enum(['STANDARD', 'PREMIUM']),
  interval: z.enum(BILLING_INTERVALS),
  successUrl: z.url(),
  cancelUrl: z.url(),
});
export type CreateCheckoutSessionInput = z.infer<typeof CreateCheckoutSessionSchema>;

export const ChangePlanSchema = z.object({
  plan: z.enum(['STANDARD', 'PREMIUM']),
  interval: z.enum(BILLING_INTERVALS),
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
