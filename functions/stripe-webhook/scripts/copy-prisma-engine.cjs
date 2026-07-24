// =====================================================================
// Prisma Query Engine を Lambda バンドルに同梱するためのコピースクリプト
// ---------------------------------------------------------------------
// esbuild で bundle した dist/index.js は、実行時に同じ階層 (/var/task) から
// Prisma の Linux 用クエリエンジン
//   libquery_engine-rhel-openssl-3.0.x.so.node
// を探す。esbuild はネイティブバイナリ (.node) を bundle しないため、
// ビルド後にこのスクリプトで dist/ 直下へコピーして ZIP に含める必要がある。
//
// schema.prisma の generator.binaryTargets に "rhel-openssl-3.0.x" が
// 含まれていれば `prisma generate` (pnpm db:generate) 時に生成される。
//
// Windows / macOS / Linux いずれの開発機でも動くよう、Node.js で実装。
// =====================================================================
const fs = require('node:fs');
const path = require('node:path');

const ENGINE_FILE = 'libquery_engine-rhel-openssl-3.0.x.so.node';
const distDir = path.resolve(__dirname, '..', 'dist');

/**
 * monorepo 内から Prisma エンジン (.so.node) を探索する。
 * pnpm のハードリンク配置 (.pnpm/@prisma+client@.../node_modules/.prisma/client)
 * を優先的に見に行き、見つからなければ再帰探索でフォールバックする。
 */
function findEngine() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const candidates = [
    // 生成された client の隣 (最も一般的)
    path.join(repoRoot, 'node_modules', '.prisma', 'client', ENGINE_FILE),
  ];

  // pnpm virtual store: node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (entry.startsWith('@prisma+client@')) {
        candidates.push(
          path.join(pnpmDir, entry, 'node_modules', '.prisma', 'client', ENGINE_FILE),
        );
      }
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // 最終手段: repoRoot 配下を浅く再帰探索
  const found = shallowSearch(repoRoot, 6);
  if (found) return found;

  return null;
}

function shallowSearch(dir, depth) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name === ENGINE_FILE) {
      return path.join(dir, e.name);
    }
  }
  for (const e of entries) {
    if (e.isDirectory() && e.name !== '.git') {
      const hit = shallowSearch(path.join(dir, e.name), depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(distDir)) {
    console.error(`[copy-prisma-engine] dist ディレクトリが見つかりません: ${distDir}`);
    console.error('[copy-prisma-engine] 先に `pnpm run build` を実行してください。');
    process.exit(1);
  }

  const engine = findEngine();
  if (!engine) {
    console.error(
      `[copy-prisma-engine] ${ENGINE_FILE} が見つかりませんでした。\n` +
        '  schema.prisma の generator.binaryTargets に "rhel-openssl-3.0.x" を追加し、\n' +
        '  `pnpm db:generate` (prisma generate) を実行してから再度お試しください。',
    );
    process.exit(1);
  }

  const dest = path.join(distDir, ENGINE_FILE);
  fs.copyFileSync(engine, dest);
  const size = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
  console.log(`[copy-prisma-engine] コピー完了: ${engine}`);
  console.log(`[copy-prisma-engine]        -> ${dest} (${size} MB)`);
}

main();
