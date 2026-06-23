/**
 * GET /api/call/ice-servers
 *
 * クライアント (CallRoom.tsx) が RTCPeerConnection を作成する直前に呼ぶ。
 *
 * 返す内容:
 *   - 常に Google の公開 STUN サーバー (2 つ)
 *   - env で TURN_URLS が設定されていれば、その TURN サーバーも併せて返す
 *     (NAT/Firewall 越え用、200人規模の特典会では推奨)
 *
 * 認可:
 *   - ログイン必須 (TURN 認証情報の漏洩を最小化するため)
 *   - 認証情報自体はサーバー固定 (Cloudflare TURN の static credential 想定)
 *   - 本格運用で短命 credential が必要になったら、別途 Cloudflare TURN Token API
 *     を呼び出してこのエンドポイントで動的発行する形に拡張可能
 *
 * 出力形式 (JSON):
 *   { iceServers: RTCIceServer[] }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { handle, errors } from '@/lib/errors';

export const runtime = 'nodejs';

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const GET = handle(async () => {
  const session = await auth();
  if (!session?.user?.id) throw errors.unauthorized();

  const iceServers: RTCIceServer[] = [...STUN_SERVERS];

  const turnUrlsRaw = process.env.TURN_URLS;
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  if (turnUrlsRaw && turnUsername && turnCredential) {
    // ; または , 区切りを許容
    const urls = turnUrlsRaw
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (urls.length > 0) {
      iceServers.push({
        urls,
        username: turnUsername,
        credential: turnCredential,
      });
    }
  }

  return NextResponse.json({ iceServers });
});
