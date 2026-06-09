import { PrismaClient } from '@prisma/client';
import { createDemoPrisma, isDemoMode } from './demo-prisma';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * DEMO_MODE=1 のときは Prisma クライアントを モックに差し替え。
 * DB 接続が無いサンドボックスでも UI を起動できる。
 */
function createClient(): PrismaClient {
  if (isDemoMode()) {
    // eslint-disable-next-line no-console
    console.warn('[prisma] DEMO_MODE 有効: モッククライアントを使用します');
    return createDemoPrisma() as unknown as PrismaClient;
  }
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['warn', 'error'],
  });
}

export const prisma: PrismaClient = global.__prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

export * from '@prisma/client';
export default prisma;
