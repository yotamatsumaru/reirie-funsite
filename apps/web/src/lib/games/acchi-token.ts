/**
 * あっちむいてPUI の 2 段階フロー用「進行トークン」(署名付き)。
 *
 * === なぜ必要か ===
 * バグ修正のため、ゲームを 2 段階に分けた:
 *   フェーズ1 (じゃんけん): `{hand}` を送信 → サーバーがじゃんけんを確定し、
 *                            この時点でプレイ回数を 1 消費 (仕様: フェーズ1で消費)。
 *                            勝った場合、方向対決の勝敗 (matched) も内部で先に抽選し、
 *                            プレイ記録を最終結果として確定する。
 *   フェーズ2 (方向対決)   : じゃんけんに勝ったときだけ `{direction}` を送信 →
 *                            サーバーは既に確定済みの matched に整合する CPU の方向を
 *                            構成して返す (勝敗はフェーズ1で確定済み。方向は見た目の整合)。
 *
 * フェーズ2は「フェーズ1で確定した結果を、方向という見た目に落とすだけ」なので、
 * クライアントが結果を改ざんできないよう、フェーズ1の確定結果を HMAC 署名した
 * トークンにして渡す。フェーズ2ではこのトークンを検証し、中の matched を使う。
 *
 * トークンには userId を含め、他人が使い回せないようにする。また短命 (既定 5 分)
 * にして、離脱後に長時間放置されたトークンの再利用を防ぐ。
 *
 * 署名鍵は API トークンと同じ env.apiToken.secret を流用する。
 */
import { SignJWT, jwtVerify } from 'jose';
import { env } from '@/lib/env';
import type { JankenHand } from '@idol/shared';

const ISSUER = env.apiToken.issuer;
const AUDIENCE = 'reirie-acchi-round2';
/** 進行トークンの有効期限 (秒)。方向を選ぶまでの猶予。既定 5 分。 */
const TOKEN_TTL_SEC = 300;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.apiToken.secret);
}

/**
 * フェーズ1 (じゃんけん勝利) の確定結果を封じ込めた進行トークンのペイロード。
 *  - sub      : userId (他ユーザーによる使い回し防止)
 *  - playId   : フェーズ1で作成した MiniGamePlay の id (監査・整合用)
 *  - matched  : 方向対決の勝敗 (true=プレイヤーの勝ち)。フェーズ1で確定済み。
 *  - hand     : プレイヤーがフェーズ1で出した手 (結果表示用)
 *  - cpuHand  : じゃんけん決着時の CPU の手 (結果表示用)
 *  - setting  : 適用された勝率設定 (監査用)
 */
export interface AcchiRound2TokenClaims {
  userId: string;
  playId: string;
  matched: boolean;
  hand: JankenHand;
  cpuHand: JankenHand;
  setting: number;
}

/** フェーズ2 に渡す進行トークンを発行する。 */
export async function signAcchiRound2Token(
  claims: AcchiRound2TokenClaims,
): Promise<string> {
  return new SignJWT({
    typ: 'acchi-round2',
    playId: claims.playId,
    matched: claims.matched,
    hand: claims.hand,
    cpuHand: claims.cpuHand,
    setting: claims.setting,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SEC}s`)
    .sign(secretKey());
}

/**
 * 進行トークンを検証して中身を返す。
 * 署名不正 / 期限切れ / 種別不一致 / userId 不一致 は null。
 */
export async function verifyAcchiRound2Token(
  token: string,
  expectedUserId: string,
): Promise<AcchiRound2TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (payload.typ !== 'acchi-round2') return null;
    if (!payload.sub || payload.sub !== expectedUserId) return null;
    if (typeof payload.playId !== 'string') return null;
    if (typeof payload.matched !== 'boolean') return null;
    if (typeof payload.hand !== 'string') return null;
    if (typeof payload.cpuHand !== 'string') return null;
    if (typeof payload.setting !== 'number') return null;
    return {
      userId: payload.sub,
      playId: payload.playId,
      matched: payload.matched,
      hand: payload.hand as JankenHand,
      cpuHand: payload.cpuHand as JankenHand,
      setting: payload.setting,
    };
  } catch {
    return null;
  }
}
