/**
 * 記事・ギャラリーの「会員向けに公開されているか」の判定を 1 箇所に集約する。
 *
 * ## なぜ必要になったか（重要）
 *
 * `Content.publishedAt` は以前から存在し、管理 API も値を受け取っていた。
 * しかし
 *
 *   1. 管理フォームに入力欄が無く、日時を指定する手段が無かった
 *      (status=PUBLISHED にすると常に「今」が入る)
 *   2. 会員向けの一覧・詳細が `status: 'PUBLISHED'` だけで絞っており
 *      **`publishedAt <= now` を見ていなかった**
 *
 * ため、仮に未来の日時を入れても即座に公開されてしまう状態だった。
 * つまり「公開予約」は実装されていなかった。
 *
 * 動画側は既に `lib/video-visibility.ts` で同じ問題を解いているので、
 * 記事側もそれに倣って判定を純粋関数として切り出す。
 * 一覧・詳細・API がそれぞれ独自に条件を持つと
 * 「一覧には出るのに詳細が 404」というズレが起きるため。
 *
 * ## status と publishedAt の役割分担
 *
 *   - `status`      … 運営の意思 (DRAFT / PUBLISHED / ARCHIVED)
 *   - `publishedAt` … いつから見せるか
 *
 * 「PUBLISHED かつ publishedAt が未来」= 公開予約済み、という表現になる。
 * status を PUBLISHED にしないと予約できないのは意図的で、
 * DRAFT のまま日時だけ入れて「公開したつもり」になる事故を防ぐ。
 */

/** 判定に必要な最小のフィールド。 */
export type ContentVisibilityInput = {
  status: string;
  publishedAt: Date | null;
};

/**
 * 会員向けの一覧・詳細に出してよいか。
 *
 * プラン (accessLevel) は見ない。公開範囲の判定は呼び出し側が
 * `accessibleLevels()` / `canAccess()` で行っており、
 * ここは「時期的に公開されているか」だけを見る。
 * 2 つを混ぜると、鍵付きで見せたいのか隠したいのかが表現できなくなる。
 */
export function isContentPublished(
  c: ContentVisibilityInput,
  now: Date = new Date(),
): boolean {
  if (c.status !== 'PUBLISHED') return false;

  /**
   * publishedAt が null の場合は「公開日時が未設定」。
   *
   * 過去のデータには status=PUBLISHED かつ publishedAt=null の行が
   * 存在しうる (以前は自動セットに頼っていたため)。
   * これを非公開扱いにすると、既存の公開済み記事が
   * この変更を入れた瞬間に一斉に消える。
   * そのため null は「いつでも公開」とみなす。
   */
  if (c.publishedAt === null) return true;

  return c.publishedAt <= now;
}

/**
 * 公開予約中 (PUBLISHED だが publishedAt が未来) か。
 * 管理画面で「予約」バッジを出すために使う。
 */
export function isContentScheduled(
  c: ContentVisibilityInput,
  now: Date = new Date(),
): boolean {
  if (c.status !== 'PUBLISHED') return false;
  if (c.publishedAt === null) return false;
  return c.publishedAt > now;
}

/**
 * Prisma の where 句に足す「公開中」条件。
 *
 * 一覧クエリごとに手書きすると、片方だけ直し忘れて
 * 「/blog には出ないのに /contents には出る」というズレが起きる。
 *
 * `OR` で null を含めるのは isContentPublished() と同じ理由
 * (publishedAt 未設定の既存データを消さないため)。
 */
export function publishedContentWhere(now: Date = new Date()) {
  return {
    status: 'PUBLISHED' as const,
    OR: [{ publishedAt: null }, { publishedAt: { lte: now } }],
  };
}

/**
 * 管理画面で使う公開状態のラベル。
 *
 * status だけを見て「公開」と表示すると、予約中の記事も
 * 「公開」に見えてしまい、運営が「もう出ているはず」と誤解する。
 */
export function contentStatusLabel(
  c: ContentVisibilityInput,
  now: Date = new Date(),
): string {
  if (c.status === 'DRAFT') return '下書き';
  if (c.status === 'ARCHIVED') return 'アーカイブ';
  return isContentScheduled(c, now) ? '公開予約' : '公開';
}
