import { z } from 'zod';

export const StartTicketLinkSchema = z.object({
  lawsonUserId: z.string().min(1).max(100),
});
export type StartTicketLinkInput = z.infer<typeof StartTicketLinkSchema>;

export const ConfirmTicketLinkSchema = z.object({
  verifyToken: z.string().min(1),
});
export type ConfirmTicketLinkInput = z.infer<typeof ConfirmTicketLinkSchema>;

export const RequestPresaleAccessSchema = z.object({
  eventId: z.uuid(),
});
export type RequestPresaleAccessInput = z.infer<typeof RequestPresaleAccessSchema>;
