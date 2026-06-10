/**
 * PM2 ecosystem 定義
 *
 * - cluster モードで CPU コア数に応じて自動スケール
 * - メモリ上限超でリスタート
 * - .env.production を自前パースして env として PM2 に渡す
 *   (注意: PM2 には公式の env_file プロパティは無い。過去の本ファイルで
 *    使われていた `env_file: '...'` は PM2 が黙って無視するため、
 *    プロセスに環境変数が一切渡らず DATABASE_URL / AUTH_TRUST_HOST 等が
 *    undefined になり Auth.js が UntrustedHost、Prisma が
 *    "Environment variable not found: DATABASE_URL" を投げる事故が発生した)
 * - ログは /home/ec2-user/logs に集約 (CloudWatch Agent が tail)
 */

const fs = require('fs');
const path = require('path');

const ENV_FILE = '/home/ec2-user/app/.env.production';

/**
 * 最小 dotenv パーサ。
 *   KEY=value  単純行
 *   KEY="value with spaces"  ダブルクォート文字列
 *   KEY='value'  シングルクォート
 *   KEY="line1\nline2"  クォート内の \n を実改行に展開しない (Auth.js / Prisma が読む値は単純文字列なので不要)
 *   #コメント行 と 空行 は無視
 *
 * 値にダブルクォートで囲まれた multi-line (= 改行を含む実値) も扱える
 * よう、クォートが閉じるまでを 1 つの値として読む。
 * (CloudFront/IVS の PEM 形式秘密鍵が複数行で書かれていても壊れない)
 */
function parseDotenv(content) {
  const out = {};
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let raw = m[2];

    // ダブルクォート開始で、同じ行で閉じていない場合は次の行以降を結合
    if (raw.startsWith('"') && !raw.slice(1).match(/(?<!\\)"\s*$/)) {
      const buf = [raw.slice(1)];
      while (i + 1 < lines.length) {
        i++;
        const next = lines[i];
        const closeIdx = next.search(/(?<!\\)"/);
        if (closeIdx >= 0) {
          buf.push(next.slice(0, closeIdx));
          break;
        }
        buf.push(next);
      }
      out[key] = buf.join('\n');
      continue;
    }

    // シングルクォート/ダブルクォート1行版を剥がす
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1);
    }
    out[key] = raw;
  }
  return out;
}

let fileEnv = {};
try {
  if (fs.existsSync(ENV_FILE)) {
    fileEnv = parseDotenv(fs.readFileSync(ENV_FILE, 'utf8'));
    // 重要: stderr に書く (stdout を汚さない)。
    // この ecosystem.config.js は `node -e "require(...)..."` で値だけ
    // 取り出すユースケース (例: psql に DATABASE_URL を渡す運用) があり、
    // stdout に何か出すと取り出した値の先頭にゴミが混ざる。
    // eslint-disable-next-line no-console
    console.error(
      `[ecosystem] loaded ${Object.keys(fileEnv).length} env vars from ${ENV_FILE}`
    );
  } else {
    // eslint-disable-next-line no-console
    console.error(`[ecosystem] env file not found: ${ENV_FILE}`);
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.error(`[ecosystem] failed to read ${ENV_FILE}:`, e.message);
}

module.exports = {
  apps: [
    {
      name: 'web',
      cwd: '/home/ec2-user/app/apps/web',
      // Next.js standalone build の server.js を起動
      script: '.next/standalone/apps/web/server.js',
      interpreter: 'node',
      // 順序重要: fileEnv を先に展開し、固定値 (NODE_ENV / HOSTNAME / PORT) で
      // 上書きする。これで .env.production の (誤った) NODE_ENV や HOSTNAME が
      // 紛れ込んでもこちらの意図を保てる。
      env: {
        ...fileEnv,
        NODE_ENV: 'production',
        HOSTNAME: '0.0.0.0',
        PORT: 3000,
      },
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '768M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      listen_timeout: 30000,
      wait_ready: false,
      error_file: '/home/ec2-user/logs/web-err.log',
      out_file: '/home/ec2-user/logs/web-out.log',
      merge_logs: true,
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      autorestart: true,
      watch: false,
    },
  ],
};
