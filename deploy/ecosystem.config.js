/**
 * PM2 ecosystem 定義
 *
 * - cluster モードで CPU コア数に応じて自動スケール
 * - メモリ上限超でリスタート
 * - .env.production を読み込み
 * - ログは /home/ec2-user/logs に集約 (CloudWatch Agent が tail)
 */
module.exports = {
  apps: [
    {
      name: 'web',
      cwd: '/home/ec2-user/app/apps/web',
      // Next.js standalone build の server.js を起動
      script: '.next/standalone/apps/web/server.js',
      interpreter: 'node',
      // standalone 出力時の HOSTNAME / PORT
      env: {
        NODE_ENV: 'production',
        HOSTNAME: '0.0.0.0',
        PORT: 3000,
      },
      env_file: '/home/ec2-user/app/.env.production',
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
