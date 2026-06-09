/**
 * メンテナンスモードフラグ
 *
 * - middleware (Edge runtime) と通常 server (Node runtime) の両方から
 *   アクセス可能な軽量モジュール
 * - globalThis 上の Symbol で共有 (プロセス内のみ。本番では Redis 等に置換)
 *
 * 制約:
 * - Edge runtime からも import されるので、`process.env` 以外の Node 専用 API を使わない
 * - 同期 API のみ
 */

const KEY = Symbol.for('@idol/maintenance-flag');

type Flag = { enabled: boolean; updatedAt: number };
type GlobalWithFlag = typeof globalThis & { [k: symbol]: Flag | undefined };

function load(): Flag {
  const g = globalThis as GlobalWithFlag;
  if (!g[KEY]) {
    g[KEY] = { enabled: false, updatedAt: 0 };
  }
  return g[KEY]!;
}

export function isMaintenanceMode(): boolean {
  // 環境変数 (CI / 緊急用) が立っていたら強制的に ON
  if (
    typeof process !== 'undefined' &&
    (process.env.MAINTENANCE_MODE === '1' ||
      process.env.MAINTENANCE_MODE === 'true')
  ) {
    return true;
  }
  return load().enabled;
}

export function setMaintenanceMode(enabled: boolean): void {
  const f = load();
  f.enabled = enabled;
  f.updatedAt = Date.now();
}
