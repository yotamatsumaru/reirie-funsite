/**
 * スロット ミニゲーム API (v1 / クライアント非依存)
 *
 * GET  /api/v1/games/slot  — 本日の残りプレイ回数・残高・配当表
 * POST /api/v1/games/slot  — 1 回転を実行 (役・絵柄・配当はサーバーが確定)
 *
 * 認証: Bearer トークン (Unity 等) または Cookie セッション (Web) のどちらでも可。
 *       → Web 版と Unity 版が「同じエンドポイント・同じロジック」を共有できる。
 *
 * 実装本体は `/api/me/games/slot` と共通で `@/lib/games/slot-handlers` にある。
 */
import { handle } from '@/lib/errors';
import { handleSlotGet, handleSlotPost } from '@/lib/games/slot-handlers';

export const runtime = 'nodejs';

export const GET = handle(handleSlotGet);
export const POST = handle(handleSlotPost);
