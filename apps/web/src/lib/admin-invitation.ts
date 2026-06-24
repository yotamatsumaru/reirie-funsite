/**
 * 管理者招待まわりの共通ヘルパ
 */
import { randomBytes } from 'node:crypto';
import { ADMIN_INVITATION_EXPIRY_DAYS } from '@idol/shared';

/** URLセーフな招待トークンを生成 (base64url, 衝突しにくい長さ) */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 現在時刻から有効期限を算出 */
export function invitationExpiresAt(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + ADMIN_INVITATION_EXPIRY_DAYS);
  return d;
}

/** 招待が「今」有効に受諾可能か (PENDING かつ未期限切れ) を判定 */
export function isInvitationAcceptable(inv: {
  status: string;
  expiresAt: Date;
}): boolean {
  return inv.status === 'PENDING' && inv.expiresAt.getTime() > Date.now();
}
