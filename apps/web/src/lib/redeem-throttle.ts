/**
 * シリアルコード引換の総当たり対策 (失敗回数ベースのスロットリング)。
 *
 * 1 ユーザーが短時間に «存在しないコード» を何度も試すのを防ぐ。
 * 正しいコードの引換は失敗にカウントしないため、通常の利用者には影響しない。
 *
 * 保存先はプロセス内メモリ。特典会のシグナリング (call-hub) も同じく単一プロセス
 * 前提のため、ここも同じ前提に揃えている (複数台構成にする場合は DB / Redis に移すこと)。
 */
const WINDOW_MS = 10 * 60 * 1000; // 10 分
const MAX_FAILURES = 10; // 10 分あたり 10 回まで

const KEY = '__idol_redeem_failures__';
type Store = Map<string, number[]>;

function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}

function recent(userId: string, now: number): number[] {
  const list = (store().get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length === 0) store().delete(userId);
  else store().set(userId, list);
  return list;
}

/** 失敗が上限に達していれば、再試行できるまでの秒数を返す。達していなければ null */
export function redeemBlockedSeconds(userId: string, now = Date.now()): number | null {
  const list = recent(userId, now);
  if (list.length < MAX_FAILURES) return null;
  return Math.max(1, Math.ceil((list[0] + WINDOW_MS - now) / 1000));
}

export function recordRedeemFailure(userId: string, now = Date.now()): void {
  const list = recent(userId, now);
  list.push(now);
  store().set(userId, list);
}
