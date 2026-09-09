/**
 * 神経衰弱 — カードをめくる
 *
 * POST /api/me/games/memory/flip  body: { index: number }
 *   位置しか受け取らない。一致判定・獲得 Pui はすべてサーバーが決める。
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

export const POST = handle(handleMemoryFlip);
