/**
 * AWS IVS Private Channel 用の署名付き再生 URL 発行
 * - JWT (ES384) を IVS Playback Private Key で署名
 *
 * NOTE: 実装簡略化のため、本リポジトリでは scaffold のみ提供。
 *       本番では aws-jwt 等を使うか、自前で署名する。
 */
import { env } from './env';
import { LIVE_SIGNED_URL_TTL_SEC } from '@idol/shared';

export function signLivePlaybackUrl(
  baseUrl: string,
  ttlSec: number = LIVE_SIGNED_URL_TTL_SEC,
): { url: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + ttlSec * 1000);
  // 本番では JWT 署名トークンを付加
  // const token = jwt.sign({...}, privateKey, { algorithm: 'ES384' });
  // return { url: `${baseUrl}?token=${token}`, expiresAt };

  if (!env.ivs.playbackKeyPairId || !env.ivs.playbackPrivateKey) {
    return { url: `${baseUrl}?dev=1`, expiresAt };
  }
  // TODO: 本番ビルド時に jsonwebtoken (ES384) を導入する
  return { url: `${baseUrl}?keypair=${env.ivs.playbackKeyPairId}`, expiresAt };
}
