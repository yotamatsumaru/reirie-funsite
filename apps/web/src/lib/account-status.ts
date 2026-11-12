/**
 * アカウントが「いまログインしていてよい状態か」の判定。
 *
 * BAN と自己都合の退会はどちらも User.deletedAt に日時が入る (ソフトデリート)。
 * 以前はログイン時 (credentials.ts) にしか見ていなかったため、
 * BAN / 退会後もブラウザのセッション (最大 30 日) やアプリのアクセストークン (1 時間) が
 * 有効なまま使えてしまっていた。
 *
 *   - ブラウザ (Cookie セッション): auth.ts の jwt callback が 5 分ごとに DB を見直すので、
 *     そこで isActiveAccount が false ならセッションを破棄する (= 最大 5 分でログアウト)。
 *   - アプリ (Bearer トークン): api-auth.ts で isAccountActiveCached を使い、
 *     1 分キャッシュ付きで確認する。
 */
import { prisma } from '@idol/db';

/** DB から取り出したユーザー行がログイン継続を許されるか */
export function isActiveAccount(
  user: { deletedAt: Date | null } | null | undefined,
): boolean {
  return !!user && user.deletedAt === null;
}

/** Bearer 認証のたびに DB を引かないためのキャッシュ時間 */
export const ACCOUNT_STATUS_CACHE_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;

const cache = new Map<string, { active: boolean; checkedAt: number }>();

/**
 * userId のアカウントが有効か (1 分キャッシュ)。
 * DB エラー時は例外をそのまま投げる (通してしまうより 500 の方が安全)。
 */
export async function isAccountActiveCached(
  userId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && now - hit.checkedAt < ACCOUNT_STATUS_CACHE_MS) return hit.active;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletedAt: true },
  });
  const active = isActiveAccount(user);
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(userId, { active, checkedAt: now });
  return active;
}

/** BAN / 退会の操作直後に呼ぶと、キャッシュを待たずに反映される (同一プロセス内) */
export function forgetAccountStatus(userId: string): void {
  cache.delete(userId);
}
