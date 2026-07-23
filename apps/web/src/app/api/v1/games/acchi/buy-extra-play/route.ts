/**
 * POST /api/v1/games/acchi/buy-extra-play
 *   - あっち向いてホイの本日の追加プレイ回数を Pui で購入する (トークン認証 / Unity 等)
 *   - Web 版 (/api/me/games/acchi/buy-extra-play) と同一ロジックを共有する
 *   - 1 日に購入できる追加回数には上限がある (MAX_EXTRA_PLAYS_PER_DAY)
 *   - Pui 残高不足時は 422 (PUI_INTEGRITY) を返す
 *
 * 実装本体は `/api/me/games/acchi/buy-extra-play` と共通化されており、
 * `@/lib/games/acchi-handlers` (`handleAcchiBuyExtraPlay`) に集約している。
 */
import { handle } from '@/lib/errors';
import { handleAcchiBuyExtraPlay } from '@/lib/games/acchi-handlers';

export const runtime = 'nodejs';

export const POST = handle(handleAcchiBuyExtraPlay);
