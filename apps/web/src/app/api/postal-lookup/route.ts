/**
 * GET /api/postal-lookup?zipcode=1570066 — 郵便番号から住所を引く公開エンドポイント
 *
 * 【なぜサーバ経由にするのか】
 * 以前はブラウザから外部サービス (zipcloud.ceres.jp) を直接叩いていたが、
 * そのホストが DNS ごと消滅したため「どの郵便番号でも住所が見つからない」障害が発生した。
 * サーバ側に寄せることで
 *   - 複数プロバイダのフォールバックを一元管理できる
 *   - 外部サービスの CORS 変更 / CSP connect-src に左右されない
 *   - 会員の郵便番号が外部サービスへ直接送信されない
 * という利点がある。
 *
 * 認証は不要 (新規登録フォームから使うため)。返す情報は郵便番号から公開されている
 * 住所 (都道府県・市区町村・町域) のみで、個人情報は含まない。
 *
 * レスポンス:
 *   200 { status:'found', prefecture, city }
 *   200 { status:'not-found' }      … 実在しない郵便番号
 *   200 { status:'unavailable' }    … 外部サービス障害等で判定できなかった
 *   400 { error: ... }              … 郵便番号の形式が不正
 *
 * ※ 「該当なし」と「判定不能」を必ず区別する。混同すると障害時に
 *    「住所が存在しない」と誤案内し、会員登録をブロックしてしまう。
 */
import { NextResponse } from 'next/server';
import { handle, errors } from '@/lib/errors';
import { normalizePostalCode, resolvePostalAddress } from '@/lib/postal-lookup';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get('zipcode') ?? '';
  const zip = normalizePostalCode(raw);
  if (!zip) throw errors.badRequest('郵便番号は7桁の数字で指定してください');

  const outcome = await resolvePostalAddress(zip);

  // 見つかった住所は郵便番号ごとに不変なので、CDN/ブラウザにキャッシュさせて
  // 外部プロバイダへの負荷とレスポンス時間を削減する。
  // 一方 unavailable (障害中) はキャッシュせず、復旧後すぐ再試行できるようにする。
  const cacheControl =
    outcome.status === 'found'
      ? 'public, max-age=86400, stale-while-revalidate=604800'
      : outcome.status === 'not-found'
        ? 'public, max-age=3600'
        : 'no-store';

  return NextResponse.json(outcome, { headers: { 'Cache-Control': cacheControl } });
});
