/**
 * GET /api/maintenance-status — メンテナンスモードの ON/OFF だけを返す公開エンドポイント
 *
 * 認証不要・情報は enabled の真偽値のみ (メッセージ等は返さない)。
 * /maintenance ページのクライアントがこれをポーリングし、メンテナンスが
 * 解除されたら自動的にトップへ遷移するために使う。
 *
 * 【重要】メンテナンス中でもこのエンドポイントは 503 にせず通す必要があるため、
 * proxy.ts の MAINTENANCE_ALWAYS_ALLOW_PREFIXES に本パスを追加している。
 */
import { NextResponse } from 'next/server';
import { isMaintenanceModeAsync } from '@/lib/maintenance-flag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const enabled = await isMaintenanceModeAsync();
  return NextResponse.json(
    { enabled },
    {
      headers: {
        // 常に最新の状態を返す (キャッシュさせない)
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
