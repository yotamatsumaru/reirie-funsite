/**
 * 神経衰弱 (PUI メモリー) — サーバー側の盤面生成と写真選定。
 *
 * ここが «権威» を持つ。クライアントは「この位置をめくる」しか送らず、
 * 盤面の中身・揃ったかどうか・獲得 Pui はすべてサーバーが決める
 * (スロット = slot.ts、あっち向いてホイ = acchi.ts と同じ方針)。
 *
 * ===================================================================
 * 【最重要】写真のアクセスレベル
 * ===================================================================
 *
 * カードの絵柄にはギャラリーの写真を使う。このとき
 * **プレイヤーが本来見られない写真を盤面に混ぜてはいけない。**
 *
 * ask#60 で「PREMIUM 限定ギャラリーの写真が URL 直叩きで取得できる」
 * 穴を塞いだが、ここで無条件に全写真から選ぶと
 * 「無料会員がゲームをすると PREMIUM 限定写真が表示される」という
 * 別の入口を作ってしまう。鍵をかけた意味が無くなる。
 *
 * そのため accessibleLevels(plan) で «そのプランで閲覧できる公開範囲» に
 * 限定してから抽選する。管理者プレビュー時も同様に扱う
 * (管理者は元々全部見られるので実害はないが、
 *  一般会員と同じ見え方を確認できるほうが検証しやすい)。
 *
 * ===================================================================
 * 【写真が足りないとき】
 * ===================================================================
 *
 * 必要枚数 (MEMORY_PAIR_COUNT) に届かない場合はゲームを開始しない。
 * 足りないぶんを «同じ写真を複数ペアに使う» で埋めると、
 * 見た目が同じで別ペアのカードが生まれ、
 * プレイヤーには «バグで揃わない» としか見えない。
 * 静かに壊れるより、理由を示して開始を断るほうが親切。
 */
import { randomInt } from 'node:crypto';
import { prisma } from '@idol/db';
import {
  accessibleLevels,
  isValidMemoryBoard,
  MEMORY_PAIR_COUNT,
  type MemoryBoard,
  type MemoryPhoto,
  type PlanTypeLiteral,
} from '@idol/shared';

/**
 * 抽選対象として DB から読み込む写真の上限。
 *
 * 全件読み込むと写真が増えるほど重くなる。
 * 十分な «ばらけ» が出る程度に多めに取り、その中からシャッフルして選ぶ。
 */
const PHOTO_POOL_LIMIT = 200;

/** 配列を暗号論的乱数でシャッフルする (Fisher-Yates) */
function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * カードに使える写真の候補を集める。
 *
 * ギャラリー (ContentType.GALLERY) の公開済みコンテンツに紐づく
 * ContentImage のうち、プレイヤーのプランで閲覧できるものだけを返す。
 *
 * @param plan プレイヤーのプラン (未ログインは呼ばれない想定だが null 安全)
 */
export async function collectMemoryPhotoPool(
  plan: PlanTypeLiteral | null | undefined,
): Promise<MemoryPhoto[]> {
  // そのプランで見られる公開範囲だけに絞る (★アクセスレベルの要★)
  const levels = accessibleLevels(plan);
  if (levels.length === 0) return [];

  const images = await prisma.contentImage.findMany({
    where: {
      content: {
        type: 'GALLERY',
        status: 'PUBLISHED',
        accessLevel: { in: levels },
      },
    },
    select: { id: true, url: true, caption: true },
    // 新しい写真から集める (最近の写真のほうがファンの関心が高い)
    orderBy: { createdAt: 'desc' },
    take: PHOTO_POOL_LIMIT,
  });

  // 同じ URL の写真が複数コンテンツに登録されている場合、
  // 別ペアとして «見た目が同じカード» が生まれてしまうため URL で重複排除する。
  const seen = new Set<string>();
  const pool: MemoryPhoto[] = [];
  for (const img of images) {
    if (!img.url) continue;
    if (seen.has(img.url)) continue;
    seen.add(img.url);
    pool.push({ id: img.id, url: img.url, caption: img.caption });
  }
  return pool;
}

/** 盤面生成の結果 */
export type BuildMemoryBoardResult =
  | { ok: true; board: MemoryBoard }
  | { ok: false; reason: 'NOT_ENOUGH_PHOTOS'; available: number; required: number };

/**
 * 写真プールから盤面を組み立てる。
 *
 * 1. プールをシャッフルして必要ペア数だけ写真を選ぶ
 * 2. 各写真のペア番号を 2 つずつ並べる
 * 3. 位置をシャッフルする
 * 4. 組んだ盤面を自己検証してから返す
 *
 * 手順 4 を入れているのは、生成側のバグで
 * 「3 枚同じ絵柄」「絶対に揃わないカード」が混ざった盤面を
 * そのまま保存してしまうと、プレイヤーからは原因不明の
 * «揃わないバグ» としか見えず、Pui の補填対応が発生するため。
 */
export function buildMemoryBoard(
  pool: MemoryPhoto[],
  pairCount = MEMORY_PAIR_COUNT,
): BuildMemoryBoardResult {
  if (pool.length < pairCount) {
    return {
      ok: false,
      reason: 'NOT_ENOUGH_PHOTOS',
      available: pool.length,
      required: pairCount,
    };
  }

  const photos = shuffle(pool).slice(0, pairCount);

  // ペア番号を 2 つずつ並べてから位置をシャッフル
  const pairs: number[] = [];
  for (let i = 0; i < pairCount; i++) pairs.push(i, i);
  const cards = shuffle(pairs);

  const board: MemoryBoard = { cards, photos };

  // 自己検証 (ここで落ちるのは生成ロジックのバグ)
  if (!isValidMemoryBoard(board)) {
    throw new Error('内部エラー: 神経衰弱の盤面生成に失敗しました');
  }

  return { ok: true, board };
}

/**
 * プレイヤーのプランに応じた盤面を生成する (写真の収集 + 組み立て)。
 */
export async function createMemoryBoardForPlan(
  plan: PlanTypeLiteral | null | undefined,
  pairCount = MEMORY_PAIR_COUNT,
): Promise<BuildMemoryBoardResult> {
  const pool = await collectMemoryPhotoPool(plan);
  return buildMemoryBoard(pool, pairCount);
}
