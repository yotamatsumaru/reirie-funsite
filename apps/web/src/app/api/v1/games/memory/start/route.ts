/**
 * 神経衰弱 — ゲーム開始
 *
 * POST /api/v1/games/memory/start
 *   新しい盤面を作る。進行中のゲームがあればそれを再開する
 *   (作り直せると有利な盤面を引き直せてしまうため)。
 *   1 日のプレイ回数はこの時点で消費する。
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

export const POST = handle(handleMemoryStart);
