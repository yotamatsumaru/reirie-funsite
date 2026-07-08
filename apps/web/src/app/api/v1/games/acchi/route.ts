/**
 * あっち向いてホイ ミニゲーム API (v1 / クライアント非依存)
 *
 * GET  /api/v1/games/acchi  — 本日の残りプレイ回数 & 残高
 * POST /api/v1/games/acchi  — 1 プレイ実行 (手と方向を送信、結果はサーバーが確定)
 *
 * 認証: Bearer トークン (Unity 等) または Cookie セッション (Web) のどちらでも可。
 *       → Web 版と Unity 版が「同じエンドポイント・同じロジック」を共有できる。
 *
 * 実装本体は `/api/me/games/acchi` と共通化されており、
 * `@/lib/games/acchi-handlers` (`handleAcchiGet` / `handleAcchiPost`) に集約している。
 * このファイルはその薄いラッパー (バージョン付き URL を維持するためのもの)。
 * URL 自体は Unity 等ネイティブクライアントとの後方互換のため維持する。
 *
 * セキュリティは Web 版 (/api/me/games/acchi) と同一:
 *  - CPU の手 / 方向 / 勝敗はサーバーで生成・確定 (クライアントの結果は信用しない)。
 *  - 回数上限・ポイント付与はトランザクション内で原子的に処理。
 */
import { handle } from '@/lib/errors';
import { handleAcchiGet, handleAcchiPost } from '@/lib/games/acchi-handlers';

export const runtime = 'nodejs';

export const GET = handle(handleAcchiGet);
export const POST = handle(handleAcchiPost);
