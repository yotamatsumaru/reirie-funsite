/**
 * GET /api/v1/games/acchi/assets
 *   あっちむいてPUI の表示素材 (キャラクター画像・ボイス) の URL を返す。
 *
 * ## なぜ必要か
 *
 * Web 版 (`/me/games/acchi`) は Server Component が
 * `getCharacterImageUrlMap()` / `getAcchiVoiceUrlMap()` を直接呼び、
 * 結果をページに埋め込んでクライアントへ渡している。
 * そのためネイティブアプリ (Flutter) から素材 URL を取得する手段が無く、
 * 管理画面で本人画像をアップロードしてもアプリには反映されなかった。
 *
 * 既存の `/api/v1/games/acchi` はゲーム状態 (残り回数・残高) だけを返し、
 * 素材 URL を含まない。素材は「1 プレイごとに変わらない」情報なので、
 * プレイ API のレスポンスに毎回同梱するのは無駄が大きい
 * (アプリ側も起動時に一度取得してキャッシュすれば足りる)。
 * そこで別エンドポイントに分ける。
 *
 * ## URL を絶対 URL に変換して返す（重要）
 *
 * 保存された url は S3 未設定の環境では
 * `/api/media/character-image/<id>?v=...` という **相対パス** になる。
 * ブラウザは «今見ているサイト» を基準に解決できるが、
 * ネイティブアプリには基準となるオリジンが無いため読み込めない。
 *
 * そのまま返すと「S3 を設定した環境では動くのに、
 * DB フォールバックの環境ではアプリだけ画像が出ない」という
 * 環境依存の不具合になる。ここで絶対 URL に正規化して返す
 * (変換は lib/media-url.ts)。
 *
 * ## 認証とゲート
 *
 * 既存の acchi API と同じく `requireGameVisible` → `requireApiPrincipal`
 * の順で通す。順序も揃えている:
 *   - ゲームが非公開なら、ログイン状態に関わらず 404 (存在を伏せる)
 *   - 公開されていればログイン必須 (会員向け機能なので)
 *
 * 画像自体の配信元 `/api/media/character-image/[id]` は
 * 「ゲーム画面の表示用であり公開情報」として認証不要になっている。
 * ここで URL 一覧に認証をかけるのは、素材が秘密だからではなく、
 * 未公開ゲームの素材から内容を推測されるのを防ぐため
 * (ゲート全体の方針に合わせる)。
 *
 * response:
 *   {
 *     characterImages: { idle: [url, ...], up: [...], down, left, right },
 *     voices: { <slot>: url, ... }
 *   }
 *
 * - 未登録のポーズ / ボイスはキーごと省略される
 *   (「キーはあるが null」だとアプリが «未設定» と «読み込み失敗» を
 *    区別できないため)
 * - characterImages が空オブジェクトなら「本人画像は未登録」を意味する。
 *   その場合アプリは Web 版と同様にイラスト等のフォールバック表示にする。
 */
import { NextResponse } from 'next/server';
import { requireApiPrincipal } from '@/lib/api-auth';
import { requireGameVisible } from '@/lib/game-visibility';
import { getCharacterImageUrlMap } from '@/lib/character-image';
import { getAcchiVoiceUrlMap } from '@/lib/game-audio';
import { toAbsoluteUrlListMap, toAbsoluteUrlMap } from '@/lib/media-url';
import { handle } from '@/lib/errors';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  // 非公開なら 404 (ログイン判定より先に通す = 存在自体を伏せる)。
  await requireGameVisible(req, 'acchi');
  await requireApiPrincipal(req);

  const [characterImages, voices] = await Promise.all([
    getCharacterImageUrlMap(),
    getAcchiVoiceUrlMap(),
  ]);

  const base = env.appBaseUrl;

  return NextResponse.json({
    /**
     * ポーズ (slot) ごとの画像 URL 配列。
     * Web 版は登録済みパターンからランダムに 1 枚選ぶ仕様なので、
     * variant 番号は返さず配列にしている (詳細は lib/media-url.ts)。
     */
    characterImages: toAbsoluteUrlListMap(characterImages, base),
    voices: toAbsoluteUrlMap(voices, base),
  });
});
