/**
 * プロモーション / デモ配信用アカウントの純粋ロジック & 定数。
 *
 * リリースイベントの配信などで使う「デモアカウント」向けの特典を判定する。
 * 副作用のない関数のみを置く (DB アクセスや現在時刻の "発生源" は含めない)。
 * 現在時刻は呼び出し側から渡す。
 *
 * === 特典 (プロモ有効時) ===
 *  - ミニゲームの 1 日プレイ回数上限を撤廃 (何度でもプレイ可能)。
 *  - あっちむいてPUI の勝率を PREMIUM 相当に固定 (よく勝つ様子を見せられる)。
 *
 * === 有効/無効の判定 ===
 *  promoUntil (User.promoUntil):
 *    - null            … 通常アカウント (特典なし)
 *    - 未来の日時       … プロモ有効
 *    - 過去の日時       … プロモ期限切れ (通常に戻る)
 *  「無期限」にしたい場合は十分先の日時を入れる。
 */

import type { PlanTypeLiteral } from './constants';

/** プロモアカウントの勝率に適用するプラン (PREMIUM 相当 = 最高勝率)。 */
export const PROMO_EFFECTIVE_PLAN: PlanTypeLiteral = 'PREMIUM';

/**
 * promoUntil から「現在プロモが有効か」を判定する純粋関数。
 * @param promoUntil User.promoUntil (null / Date / ISO 文字列)
 * @param now        判定基準の現在時刻 (呼び出し側から渡す)
 */
export function isPromoActive(
  promoUntil: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!promoUntil) return false;
  const until = promoUntil instanceof Date ? promoUntil : new Date(promoUntil);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() > now.getTime();
}
