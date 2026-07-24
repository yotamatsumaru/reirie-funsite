/**
 * Prisma Client シングルトン (Lambda コンテナ再利用最適化)
 *
 * Lambda の同一実行環境内では再利用される (warm start)。
 * RDS Proxy 利用を推奨。
 *
 * ## Prisma エンジンの場所を明示する理由
 * esbuild --bundle --minify は Prisma のクエリエンジン探索ロジックを壊し、
 * ビルドマシン (Windows) の絶対パスをバンドルに焼き込んでしまう。
 * その結果 Lambda 実行時に /var/task の同梱エンジンを見つけられず
 * `PrismaClientInitializationError: could not locate the Query Engine` になる。
 *
 * ここで PRISMA_QUERY_ENGINE_LIBRARY を、ZIP に同梱した
 * /var/task 直下 (または .prisma/client 配下) のエンジン絶対パスに設定してから
 * @idol/db (= PrismaClient を new する) を読み込むことで確実に解決する。
 *
 * 注意: この設定は PrismaClient が生成される「前」に行う必要があるため、
 *       @idol/db の import より前で環境変数をセットする。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE_FILE = 'libquery_engine-rhel-openssl-3.0.x.so.node';

/**
 * 同梱エンジンの絶対パスを解決して PRISMA_QUERY_ENGINE_LIBRARY に設定する。
 * すでに環境変数が設定されている場合はそれを尊重する (Lambda の環境変数優先)。
 */
function ensureEngineLibraryPath(): void {
  if (process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
    return;
  }

  // Lambda では /var/task がデプロイパッケージの展開先。
  // ローカル/その他環境では __dirname (バンドル出力ディレクトリ) を基準にする。
  const baseDirs = [
    process.env.LAMBDA_TASK_ROOT || '/var/task',
    __dirname,
  ];

  for (const base of baseDirs) {
    const candidates = [
      join(base, '.prisma', 'client', ENGINE_FILE), // 主: 同梱時の配置
      join(base, ENGINE_FILE), // 副: ZIP ルート
    ];
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) {
          process.env.PRISMA_QUERY_ENGINE_LIBRARY = candidate;
          // eslint-disable-next-line no-console
          console.log(`[stripe-webhook] Prisma engine を検出: ${candidate}`);
          return;
        }
      } catch {
        // existsSync が失敗しても次の候補へ
      }
    }
  }

  // eslint-disable-next-line no-console
  console.warn(
    '[stripe-webhook] 同梱 Prisma エンジンが見つかりませんでした。PRISMA_QUERY_ENGINE_LIBRARY は未設定のままです。',
  );
}

ensureEngineLibraryPath();

// エンジンパス設定後に PrismaClient を読み込む (require で評価順を保証)。
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const { prisma } = require('@idol/db') as typeof import('@idol/db');
