/**
 * あっち向いてホイ ミニゲーム API (Web)
 *
 * GET  /api/me/games/acchi  — 本日の残りプレイ回数 & 残高を取得
 * POST /api/me/games/acchi  — 1 プレイを実行 (じゃんけん + 方向を送信、結果はサーバーが確定)
 *
 * 認証: Bearer トークン (モバイル/Unity 等) または Cookie セッション (Web) のどちらでも可。
 *
 * 実装本体は `/api/v1/games/acchi` と共通化されており、
 * `@/lib/games/acchi-handlers` (`handleAcchiGet` / `handleAcchiPost`) に集約している。
 * このファイルはその薄いラッパー (Web 用 URL を維持するためのもの)。
 *
 * セキュリティ:
 *  - CPU の手 / 方向 / 勝敗はすべてサーバーで生成・確定 (クライアントの結果は信用しない)。
 *  - 勝率は「プレイヤーのプランに割り当てられた設定 (1〜6)」でサーバーが制御する。
 *    プランは JWT ではなく DB の有効サブスクリプションから都度解決する (改ざん不可)。
 *  - 1 日の回数上限・ポイント付与はトランザクション内で原子的に処理 (cluster でも安全)。
 */
import { handle } from '@/lib/errors';
import { handleAcchiGet, handleAcchiPost } from '@/lib/games/acchi-handlers';

export const runtime = 'nodejs';

export const GET = handle(handleAcchiGet);
export const POST = handle(handleAcchiPost);
