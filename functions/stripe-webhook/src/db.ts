/**
 * Prisma Client シングルトン (Lambda コンテナ再利用最適化)
 *
 * Lambda の同一実行環境内では再利用される (warm start)。
 * RDS Proxy 利用を推奨。
 */
export { prisma } from '@idol/db';
