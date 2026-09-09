/**
 * 神経衰弱 (PUI メモリー) — 状態取得
 *
 * GET /api/me/games/memory
 *   本日の残りプレイ回数・Pui 残高・進行中の盤面 (あれば) を返す。
 *   ★未めくりカードの写真は含まれない (盤面を漏らさない)★
 *
 * 実装本体は Web / ネイティブ共通で `@/lib/games/memory-handlers` にある。
 */
import { handle } from '@/lib/errors';
import {
  handleMemoryGet,
  handleMemoryStart,
  handleMemoryFlip,
  handleMemoryGiveUp,
} from '@/lib/games/memory-handlers';

export const runtime = 'nodejs';

export const GET = handle(handleMemoryGet);
