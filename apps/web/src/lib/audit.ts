import { prisma } from '@idol/db';

export async function logAudit(params: {
  userId?: string | null;
  action: string;
  resource?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        resource: params.resource,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        metadata: params.metadata as never,
      },
    });
  } catch (err) {
    // 監査ログ失敗で本処理を止めない
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write', err);
  }
}
