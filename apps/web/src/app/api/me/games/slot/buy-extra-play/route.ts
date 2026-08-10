/**
 * POST /api/me/games/slot/buy-extra-play
 *   - スロットの本日の追加プレイ回数を Pui で購入する
 *   - 1 日に購入できる追加回数には上限がある (MAX_EXTRA_PLAYS_PER_DAY)
 *   - Pui 残高不足時は 422 (PUI_INTEGRITY) を返す
 */
import { handle } from '@/lib/errors';
import { handleSlotBuyExtraPlay } from '@/lib/games/slot-handlers';

export const runtime = 'nodejs';

export const POST = handle(handleSlotBuyExtraPlay);
