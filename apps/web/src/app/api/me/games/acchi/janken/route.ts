/**
 * あっちむいてPUI — 2段階フロー・フェーズ1 (じゃんけん)
 *
 * POST /api/me/games/acchi/janken — 手だけを送信してじゃんけんを確定する。
 *
 * このエンドポイントでプレイ回数を 1 消費する (仕様: フェーズ1で消費)。
 *  - じゃんけんで負け → 最終結果 LOSE を記録し、即結果を返す。
 *  - じゃんけんで勝ち → 方向対決の勝敗も内部で確定・記録し、方向対決用の
 *    署名付き進行トークンを返す。クライアントはこのトークンで
 *    フェーズ2 (POST .../direction) に進む。
 *
 * 「じゃんけんの結果が出る前に方向(指)を選ばされる」旧バグを解消するための分割。
 *
 * 認証: Cookie セッション (Web) または Bearer トークン。
 */
import { handle } from '@/lib/errors';
import { handleAcchiJanken } from '@/lib/games/acchi-handlers';

export const runtime = 'nodejs';

export const POST = handle(handleAcchiJanken);
