import { z } from 'zod';
import { ACCESS_LEVELS } from '../constants';

export const CreateLiveStreamSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  thumbnailUrl: z.url().optional(),
  isPrivate: z.boolean().default(true),
  accessLevel: z.enum(ACCESS_LEVELS).default('MEMBERS'),
  scheduledStartAt: z.iso.datetime().optional(),
});
export type CreateLiveStreamInput = z.infer<typeof CreateLiveStreamSchema>;

export const LivePlaybackTokenResponseSchema = z.object({
  playbackUrl: z.url(),
  expiresAt: z.iso.datetime(),
});
