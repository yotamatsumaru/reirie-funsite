/**
 * あっちむいてPUI サーバーエラーの本番診断スクリプト。
 *
 * 使い方 (EC2 上, /home/ec2-user/app で):
 *   node deploy/diagnose-acchi.mjs
 *
 * ecosystem.config.js から DATABASE_URL を読むため、環境変数の事前設定は不要。
 * (PM2 と同じ env 解決を使う)
 *
 * 何を確認するか:
 *   1. users.promo_until カラムの有無
 *   2. mini_game_plays の全カラム (bonus_reward_point / reward_point の有無)
 *   3. _prisma_migrations の適用済み一覧と、失敗 (rolled_back / applied_steps=0) の有無
 *   4. 実際に mini_game_plays へ 1 行 INSERT → ROLLBACK して、書き込みが通るか
 *      (janken POST が失敗する箇所をピンポイントで再現)
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// pnpm の仮想ストア配置でも確実に解決できるよう、リポジトリ各所を探索して
// @prisma/client を require する (bare ESM import だと解決に失敗することがある)。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const req = createRequire(import.meta.url);
const prismaPath = req.resolve('@prisma/client', {
  paths: [
    path.join(repoRoot, 'packages/db'),
    path.join(repoRoot, 'apps/web'),
    repoRoot,
  ],
});
const { PrismaClient } = req(prismaPath);

const prisma = new PrismaClient();

function line() {
  console.log('------------------------------------------------------------');
}

async function main() {
  console.log('=== あっちむいてPUI 本番診断 ===');
  line();

  // 1. users.promo_until
  const promoCol = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'promo_until'`,
  );
  console.log('[1] users.promo_until:', promoCol.length ? promoCol : '❌ 存在しない');
  line();

  // 2. mini_game_plays の全カラム
  const mgpCols = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name = 'mini_game_plays' ORDER BY ordinal_position`,
  );
  console.log('[2] mini_game_plays columns:');
  for (const c of mgpCols) {
    console.log(`    - ${c.column_name} (${c.data_type}, null=${c.is_nullable}, default=${c.column_default})`);
  }
  const names = mgpCols.map((c) => c.column_name);
  const need = ['reward_point', 'bonus_reward_point', 'result', 'detail'];
  for (const n of need) {
    console.log(`    check ${n}: ${names.includes(n) ? '✅' : '❌ 欠落'}`);
  }
  line();

  // 3. マイグレーション状態
  console.log('[3] _prisma_migrations:');
  try {
    const migs = await prisma.$queryRawUnsafe(
      `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
       FROM _prisma_migrations ORDER BY started_at`,
    );
    for (const m of migs) {
      const ok = m.finished_at && !m.rolled_back_at;
      console.log(
        `    ${ok ? '✅' : '⚠️ '} ${m.migration_name} (finished=${!!m.finished_at}, rolledBack=${!!m.rolled_back_at}, steps=${m.applied_steps_count})`,
      );
    }
  } catch (e) {
    console.log('    (取得できませんでした:', e instanceof Error ? e.message : e, ')');
  }
  line();

  // 4. 実際に mini_game_plays へ書き込みテスト (ROLLBACK)
  console.log('[4] mini_game_plays への INSERT テスト (実際には保存しない/ROLLBACK):');
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "mini_game_plays" ("id","user_id","game_type","date","result","reward_point","bonus_reward_point","detail","created_at")
         SELECT gen_random_uuid(), u.id, 'ACCHI_MUITE_HOI', '2000-01-01', 'LOSE', 0, 0, NULL, now()
         FROM "users" u LIMIT 1`,
      );
      // わざと失敗させて必ず ROLLBACK する
      throw new Error('__ROLLBACK__');
    });
  } catch (e) {
    if (e instanceof Error && e.message === '__ROLLBACK__') {
      console.log('    ✅ INSERT 自体は成功した (ROLLBACK 済み)。書き込み経路は正常。');
    } else {
      console.log('    ❌ INSERT が失敗しました。これが janken POST 500 の原因の可能性大:');
      console.log('   ', e);
    }
  }
  line();
  console.log('=== 診断完了 ===');
}

main()
  .catch((e) => {
    console.error('診断スクリプトが例外で停止:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
