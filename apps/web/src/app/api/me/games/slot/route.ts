/**
 * スロット ミニゲーム API (Web)
 *
 * GET  /api/me/games/slot  — 本日の残りプレイ回数・残高・配当表を取得
 * POST /api/me/games/slot  — 1 回転を実行 (役・絵柄・配当はサーバーが確定)
 *
 * 認証: Bearer トークン (モバイル/Unity 等) または Cookie セッション (Web) のどちらでも可。
 *
 * 実装本体は `/api/v1/games/slot` と共通化されており、
 * `@/lib/games/slot-handlers` に集約している。このファイルは薄いラッパー。
 */
import { handle } from '@/lib/errors';
import { handleSlotGet, handleSlotPost } from '@/lib/games/slot-handlers';

export const runtime = 'nodejs';

export const GET = handle(handleSlotGet);
export const POST = handle(handleSlotPost);
