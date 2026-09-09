/**
 * 神経衰弱 — 途中でやめる
 *
 * POST /api/me/games/memory/giveup
 *   揃えたぶんの Pui を受け取って終了する。
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

export const POST = handle(handleMemoryGiveUp);
