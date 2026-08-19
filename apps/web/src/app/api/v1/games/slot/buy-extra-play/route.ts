/**
 * POST /api/v1/games/slot/buy-extra-play
 *   - スロットの本日の追加プレイ回数を Pui で購入する (v1 / クライアント非依存)
 *
 * 実装本体は `/api/me/games/slot/buy-extra-play` と共通。
 */
import { handle } from '@/lib/errors';
import { handleSlotBuyExtraPlay } from '@/lib/games/slot-handlers';

export const runtime = 'nodejs';

export const POST = handle(handleSlotBuyExtraPlay);
