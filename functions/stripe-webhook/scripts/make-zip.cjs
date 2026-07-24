// =====================================================================
// Lambda デプロイ用 ZIP を作成するスクリプト (OS 非依存)
// ---------------------------------------------------------------------
// ZIP に以下を格納する:
//   - index.js                                          (ZIP ルート)
//   - index.js.map                                      (ZIP ルート)
//   - .prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node  (主: バンドルが探す場所)
//   - libquery_engine-rhel-openssl-3.0.x.so.node        (副: ルート直下フォールバック)
//
// バンドルされた Prisma Client は実行時に index.js の隣の
// ".prisma/client/" を探索する (CloudWatch の searched paths で確認)。
// そのため .prisma/client 配下への配置が必須。ルート直下にも置いて二重化する。
//
// PowerShell の Compress-Archive は相対パス次第でルート階層がずれるため、
// Node.js から確実に ZIP を組み立てる。zip コマンドが無い Windows でも動く。
//
// 出力: functions/stripe-webhook/dist/function.zip
// =====================================================================
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const distDir = path.resolve(__dirname, '..', 'dist');
const ENGINE_FILE = 'libquery_engine-rhel-openssl-3.0.x.so.node';
const NESTED_ENGINE = path.join('.prisma', 'client', ENGINE_FILE);

// ZIP 内に格納するエントリ (posix 形式の相対パス)
const ENTRIES = ['index.js', 'index.js.map', NESTED_ENGINE, ENGINE_FILE];
const zipPath = path.join(distDir, 'function.zip');

function assertFiles() {
  const missing = ENTRIES.filter((f) => !fs.existsSync(path.join(distDir, f)));
  if (missing.length > 0) {
    console.error(`[zip] dist に必要なファイルがありません: ${missing.join(', ')}`);
    console.error('[zip] `pnpm run build:full` (build → copy-engine) を先に実行してください。');
    process.exit(1);
  }
}

function tryArchiver() {
  let archiver;
  try {
    archiver = require('archiver');
  } catch {
    return false;
  }
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(output);
  for (const f of ENTRIES) {
    // ZIP 内パスは posix 区切りに正規化
    const name = f.split(path.sep).join('/');
    archive.file(path.join(distDir, f), { name });
  }
  archive.finalize();
  return true;
}

function tryZipCommand() {
  // Linux/macOS: dist をカレントにしてディレクトリ構造を保持 (-j は使わない)
  try {
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
    const posixEntries = ENTRIES.map((f) => f.split(path.sep).join('/'));
    execFileSync('zip', ['-r', zipPath, ...posixEntries], { cwd: distDir, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

function tryPowerShell() {
  // Windows: index.js / index.js.map / .prisma フォルダ / ルートエンジンを
  // dist をカレントにして Compress-Archive (フォルダ構造を保持)
  try {
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
    const paths = ['index.js', 'index.js.map', '.prisma', ENGINE_FILE]
      .map((f) => `'${f}'`)
      .join(', ');
    const cmd = `Compress-Archive -Path ${paths} -DestinationPath 'function.zip' -Force`;
    execFileSync('powershell', ['-NoProfile', '-Command', cmd], {
      cwd: distDir,
      stdio: 'inherit',
    });
    return true;
  } catch (err) {
    console.error('[zip] PowerShell Compress-Archive に失敗:', err.message);
    return false;
  }
}

function main() {
  assertFiles();
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);

  if (tryArchiver() || tryZipCommand() || tryPowerShell()) {
    console.log(`[zip] 作成しました: ${zipPath}`);
    console.log('[zip] 含まれるエントリ:');
    for (const f of ENTRIES) console.log(`  - ${f.split(path.sep).join('/')}`);
  } else {
    console.error('[zip] ZIP 作成手段が見つかりませんでした (archiver / zip / powershell いずれも不可)。');
    process.exit(1);
  }
}

main();
