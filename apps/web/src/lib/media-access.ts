/**
 * DB 保存メディア (本文画像 / 本文動画 / ギャラリー写真) を
 * 「配信してよいか」を判定する純粋関数。
 *
 * ## なぜ必要になったのか（重要）
 *
 * 配信エンドポイント `/api/media/content-body-image/[id]` は、
 * これまで **意図的に無認証** だった。当時のコメントはこう書かれていた:
 *
 *   > 認証は不要。本文画像は記事の一部として <img src> で読まれるものであり、
 *   > 記事自体の公開範囲 (AccessLevel) は記事ページ側で制御されるため。
 *   > URL は UUID なので推測による列挙も現実的でない。
 *
 * ブログ本文の画像に限れば、この判断は妥当だった。
 * しかしギャラリー機能で **同じエンドポイントが写真の配信に使われる** ようになり、
 * 前提が崩れた。実際に検証したところ、
 *
 *   - PREMIUM 限定ギャラリーのページ … 未ログインでは課金案内が出る（正しい）
 *   - その写真の URL を直接叩く      … 未ログインでも 200 で画像が返る（穴）
 *
 * という状態だった。写真そのものが誰にでも取得できるなら、
 * 「公開範囲を設ける」も「コピーを防ぐ」も成立しない。
 * URL は共有・ブックマーク・SNS 転載で簡単に流通するため、
 * 「UUID だから推測できない」は限定公開の根拠にはならない。
 *
 * ## 判定の方針 — 「一番ゆるい参照元」に合わせる
 *
 * 1 枚の画像は複数のコンテンツから参照され得る
 * (同じ写真を公開ブログとプレミアムギャラリーの両方で使う、など)。
 * このとき **最もゆるい公開範囲** を要求水準とする。
 *
 * 厳しい側 (PREMIUM) に合わせると、公開ブログに貼った画像が
 * 「別の限定ギャラリーでも使われている」だけで未ログインに出なくなり、
 * 公開記事が崩れる。これは事故として気付きにくく影響も広い。
 * ゆるい側に合わせた場合の «漏れ» は「運営がその画像を公開記事にも貼った」
 * という運営自身の行為の結果であり、閲覧者から見て矛盾がない。
 *
 * ## どこからも参照されていない画像
 *
 * PUBLIC 扱いにする。理由は、記事を書き始める前にアップロードした画像
 * (ContentBodyImage は contentId を持たない) や、
 * 記事から外した後の画像がここに該当し、
 * これを弾くと **編集中の管理画面でプレビューが表示されなくなる** ため。
 * ただし管理者は別途バイパスするので、
 * 「未参照は公開」はあくまで既定の緩やかな初期値として置く。
 */
import { canAccess } from '@idol/shared';
import type { AccessLevelLiteral, PlanTypeLiteral } from '@idol/shared';

/** 参照元コンテンツのうち、判定に必要な最小のフィールド */
export type MediaReferrer = {
  accessLevel: AccessLevelLiteral;
};

/**
 * このメディアを見るために必要な公開範囲。
 *
 * 参照元が複数ある場合は最もゆるいものを返す（上のコメント参照）。
 * 参照元が無い場合は 'PUBLIC'。
 */
export function requiredLevelForMedia(referrers: MediaReferrer[]): AccessLevelLiteral {
  if (referrers.length === 0) return 'PUBLIC';

  // 「ゆるい」= 未ログインの誰かが見られる度合いが高い。
  // canAccess(undefined, level) が true なのは PUBLIC のみなので、
  // 順位表を別に持たず accessibleLevels の考え方に合わせて比較する。
  const RANK: Record<AccessLevelLiteral, number> = {
    PUBLIC: 0,
    FREE_MEMBERS: 1,
    MEMBERS: 2,
    PREMIUM: 3,
  };

  return referrers.reduce<AccessLevelLiteral>((loosest, r) => {
    return RANK[r.accessLevel] < RANK[loosest] ? r.accessLevel : loosest;
  }, referrers[0]!.accessLevel);
}

/**
 * メディアを配信してよいか。
 *
 * `isStaff` は管理者バイパス。管理画面の編集中プレビューや、
 * 予約公開・下書きの確認で自分がアップロードした画像を見る必要があるため。
 * 権限判定そのものは呼び出し側 (route) が session から行う。
 */
export function canDeliverMedia(params: {
  referrers: MediaReferrer[];
  plan: PlanTypeLiteral | undefined | null;
  isStaff?: boolean;
}): boolean {
  if (params.isStaff) return true;
  return canAccess(params.plan, requiredLevelForMedia(params.referrers));
}

/**
 * 配信時の Cache-Control。
 *
 * 限定公開のメディアで `public, immutable` を返すと、
 * CDN (CloudFront) や社内プロキシに実体がキャッシュされ、
 * **認証を通らないまま第三者へ配信され得る**。
 * サーバー側でどれだけ判定しても、手前のキャッシュが素通りさせれば意味がない。
 *
 * そのため公開範囲が PUBLIC 以外のものは `private, no-store` とし、
 * 共有キャッシュに残さない。
 * PUBLIC のものは従来どおり長期 immutable でよい
 * (URL に UUID が入り内容が変わらないため)。
 */
export function mediaCacheControl(level: AccessLevelLiteral): string {
  if (level === 'PUBLIC') return 'public, max-age=31536000, immutable';
  return 'private, no-store, max-age=0, must-revalidate';
}
