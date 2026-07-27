// =====================================================================
// Lambda デプロイ用 ZIP を作成するスクリプト (OS 非依存)
// ---------------------------------------------------------------------
// この Lambda は AWS SDK / Prisma に依存せず、Node.js 20 の グローバル fetch で
// Web API を叩くだけなので、ZIP に必要なのは以下だけ:
//   - index.js       (ZIP ルート)
//   - index.js.map   (ZIP ルート)
//
// `pnpm run build` (esbuild bundle) 後に実行してください。
// 出力: functions/video-job-complete/dist/function.zip
// =====================================================================
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const distDir = path.resolve(__dirname, '..', 'dist');
const ENTRIES = ['index.js', 'index.js.map'];
const zipPath = path.join(distDir, 'function.zip');

function assertFiles() {
  const missing = ENTRIES.filter((f) => !fs.existsSync(path.join(distDir, f)));
  if (missing.length > 0) {
    console.error(`[zip] dist に必要なファイルがありません: ${missing.join(', ')}`);
    console.error('[zip] 先に `pnpm run build` を実行してください。');
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
    archive.file(path.join(distDir, f), { name: f });
  }
  archive.finalize();
  return true;
}

function tryZipCommand() {
  try {
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
    execFileSync('zip', ['-j', zipPath, ...ENTRIES.map((f) => path.join(distDir, f))], {
      stdio: 'inherit',
    });
    return true;
  } catch {
    return false;
  }
}

function tryPowerShell() {
  try {
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
    const paths = ENTRIES.map((f) => `'${f}'`).join(', ');
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
    for (const f of ENTRIES) console.log(`  - ${f}`);
  } else {
    console.error('[zip] ZIP 作成手段が見つかりませんでした (archiver / zip / powershell いずれも不可)。');
    process.exit(1);
  }
}

main();
