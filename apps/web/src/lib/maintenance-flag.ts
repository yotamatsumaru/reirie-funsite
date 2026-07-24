/**
 * メンテナンスモードフラグ
 *
 * - proxy.ts (Next.js 16 proxy, Node runtime) と通常の server component / route handler
 *   の両方から参照される。
 * - 永続化は AppSetting (site.maintenance) に対して行う (app-setting.ts)。
 *   これにより PM2 cluster の全ワーカー・再起動を跨いで状態が共有される。
 * - proxy.ts での判定を高速化するため、AppSetting から読んだ値を短時間 (数秒)
 *   プロセス内メモリにキャッシュする (globalThis 上の Symbol)。
 * - 緊急用に環境変数 MAINTENANCE_MODE=1 でも強制 ON にできる (DB 不要)。
 *
 * 【role 制御】メンテナンス中に「誰を通すか」の判定は proxy.ts 側で JWT の role を
 *   見て行う (SUPER_ADMIN のみ通過)。ここではサイト全体の ON/OFF のみを扱う。
 */
import { getMaintenanceSetting } from '@/lib/app-setting';

const CACHE_KEY = Symbol.for('@idol/maintenance-flag-cache');

type Cache = { enabled: boolean; fetchedAt: number };
type GlobalWithCache = typeof globalThis & { [k: symbol]: Cache | undefined };

/** キャッシュ有効期間 (ms)。切り替えの反映がこの秒数だけ遅れる可能性がある。 */
const CACHE_TTL_MS = 5_000;

function envForced(): boolean {
  return (
    typeof process !== 'undefined' &&
    (process.env.MAINTENANCE_MODE === '1' || process.env.MAINTENANCE_MODE === 'true')
  );
}

function readCache(): Cache {
  const g = globalThis as GlobalWithCache;
  if (!g[CACHE_KEY]) {
    g[CACHE_KEY] = { enabled: false, fetchedAt: 0 };
  }
  return g[CACHE_KEY]!;
}

function writeCache(enabled: boolean): void {
  const g = globalThis as GlobalWithCache;
  g[CACHE_KEY] = { enabled, fetchedAt: Date.now() };
}

/**
 * メンテナンスモードが有効かどうかを (永続 AppSetting を参照して) 判定する。
 * 短時間キャッシュ付き。proxy.ts はこの async 版を使う。
 */
export async function isMaintenanceModeAsync(): Promise<boolean> {
  if (envForced()) return true;

  const cache = readCache();
  const fresh = Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (fresh) return cache.enabled;

  try {
    const setting = await getMaintenanceSetting();
    writeCache(setting.enabled);
    return setting.enabled;
  } catch {
    // DB 障害時は安全側 = 通常運用 (ロックアウト回避)。ただし env 強制は上で処理済み。
    return cache.enabled;
  }
}

/**
 * 直近にキャッシュ済みの値を同期で返す (env 強制も反映)。
 * DB を読まないため server component の軽い分岐用。厳密さが必要なら async 版を使う。
 */
export function isMaintenanceMode(): boolean {
  if (envForced()) return true;
  return readCache().enabled;
}

/**
 * 設定変更後にキャッシュを即時更新する (API から呼び、反映遅延をなくす)。
 */
export function primeMaintenanceCache(enabled: boolean): void {
  writeCache(enabled);
}
