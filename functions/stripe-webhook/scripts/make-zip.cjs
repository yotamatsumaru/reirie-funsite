// =====================================================================
// Lambda デプロイ用 ZIP を作成するスクリプト (OS 非依存)
// ---------------------------------------------------------------------
// dist/ 直下の以下を ZIP ルートに格納する:
//   - index.js
//   - index.js.map
//   - libquery_engine-rhel-openssl-3.0.x.so.node  (Prisma エンジン)
//
// PowerShell の Compress-Archive は実行時のカレントや相対パスにより
// ルート階層がずれやすく、Prisma エンジンが同梱漏れになりがちなため、
// Node.js から確実に ZIP を組み立てる。zip コマンドが無い Windows でも動く。
//
// 出力: functions/stripe-webhook/dist/function.zip
// =====================================================================
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const distDir = path.resolve(__dirname, '..', 'dist');
const ENGINE_FILE = 'libquery_engine-rhel-openssl-3.0.x.so.node';
const REQUIRED = ['index.js', 'index.js.map', ENGINE_FILE];
const zipPath = path.join(distDir, 'function.zip');

function assertFiles() {
  const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(distDir, f)));
  if (missing.length > 0) {
    console.error(`[zip] dist に必要なファイルがありません: ${missing.join(', ')}`);
    console.error('[zip] `pnpm run build:full` (build → copy-engine) を先に実行してください。');
    process.exit(1);
  }
}

function tryArchiver() {
  // archiver が入っていれば純 Node で ZIP 生成 (依存が無ければ null を返す)
  let archiver;
  try {
    archiver = require('archiver');
  } catch {
    return false;
  }
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(output);
  for (const f of REQUIRED) {
    archive.file(path.join(distDir, f), { name: f });
  }
  archive.finalize();
  return true;
}

function tryZipCommand() {
  // Linux/macOS の zip コマンド (dist をカレントにしてルート格納)
  try {
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
    execFileSync('zip', ['-j', '-r', zipPath, ...REQUIRED], { cwd: distDir, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

function tryPowerShell() {
  // Windows: Compress-Archive を dist をカレントにして実行 (ルート格納を保証)
  try {
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
    const psArgs = REQUIRED.map((f) => `'${f}'`).join(', ');
    const cmd = `Compress-Archive -Path ${psArgs} -DestinationPath 'function.zip' -Force`;
    execFileSync('powershell', ['-NoProfile', '-Command', cmd], {
      cwd: distDir,
      stdio: 'inherit',
    });
    return true;
  } catch {
    return false;
  }
}

function main() {
  assertFiles();
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);

  if (tryArchiver() || tryZipCommand() || tryPowerShell()) {
    console.log(`[zip] 作成しました: ${zipPath}`);
    console.log('[zip] 含まれるファイル:');
    for (const f of REQUIRED) console.log(`  - ${f}`);
  } else {
    console.error('[zip] ZIP 作成手段が見つかりませんでした (archiver / zip / powershell いずれも不可)。');
    process.exit(1);
  }
}

main();
