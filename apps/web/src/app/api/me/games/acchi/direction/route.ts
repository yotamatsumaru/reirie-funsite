/**
 * あっちむいてPUI — 2段階フロー・フェーズ2 (方向対決)
 *
 * POST /api/me/games/acchi/direction — フェーズ1で得た進行トークン + 指す方向を送信。
 *
 * 勝敗はフェーズ1で確定済み (トークン内の matched)。このエンドポイントは
 * その勝敗に整合する CPU の方向を構成して返すだけで、DB は変更しない
 * (プレイ回数の消費・ポイント付与はフェーズ1で完了済み)。
 *
 * 認証: Cookie セッション (Web) または Bearer トークン。
 */
import { handle } from '@/lib/errors';
import { handleAcchiDirection } from '@/lib/games/acchi-handlers';

export const runtime = 'nodejs';

export const POST = handle(handleAcchiDirection);
