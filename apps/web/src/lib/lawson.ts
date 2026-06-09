/**
 * Lawson Ticket (ローチケ) 連携クライアント
 *
 * 本番では実際の Lawson Ticket API (パートナー API) と通信するが、
 * MVP 段階ではモック実装を提供。
 * - LAWSON_TICKET_API_BASE が空 → モックモード (開発用)
 * - LAWSON_TICKET_API_BASE が設定済み → fetch で実 API を叩く
 *
 * 主な責務:
 *  - lawsonUserId の検証 (連携開始時)
 *  - 連携確認トークンの発行/検証
 *  - 先行販売権の登録 (ローチケ側に「このローチケIDはイベントXの先行販売対象」と伝える)
 */
import crypto from 'node:crypto';
import { env } from './env';

export interface LawsonVerifyStartResult {
  /** ローチケに送る検証トークン (ユーザーがローチケでこのコードを入力) */
  verifyToken: string;
  /** トークンの有効期限 */
  expiresAt: Date;
}

export interface LawsonVerifyConfirmResult {
  ok: boolean;
  /** ローチケ側で確認済みのユーザーID */
  lawsonUserId?: string;
  reason?: string;
}

export interface LawsonGrantPresaleParams {
  lawsonUserId: string;
  externalEventId: string;
  expiresAt?: Date;
}

export interface LawsonGrantPresaleResult {
  ok: boolean;
  externalGrantId?: string;
  reason?: string;
}

const isMock = !env.lawson.apiBase || !env.lawson.apiKey;

/**
 * 連携開始: ユーザーが入力した lawsonUserId に対して
 * 検証トークンを払い出す。
 * 本番ではローチケ側に「このユーザーIDにメール送るので確認コード入れて」と依頼する。
 */
export async function startLawsonLink(lawsonUserId: string): Promise<LawsonVerifyStartResult> {
  // 30 分有効
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  if (isMock) {
    // モック: lawsonUserId をベースに決定論的トークンを生成
    const verifyToken = crypto
      .createHash('sha256')
      .update(`mock:${lawsonUserId}:${env.auth.secret}`)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();
    return { verifyToken, expiresAt };
  }

  const res = await fetch(`${env.lawson.apiBase}/v1/link/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.lawson.apiKey,
      'x-partner-id': env.lawson.partnerId,
    },
    body: JSON.stringify({ lawsonUserId }),
  });
  if (!res.ok) {
    throw new Error(`Lawson startLink failed: ${res.status}`);
  }
  const json = (await res.json()) as { verifyToken: string; expiresAt: string };
  return { verifyToken: json.verifyToken, expiresAt: new Date(json.expiresAt) };
}

/**
 * 連携確認: ユーザーがローチケで受け取ったコードを送ってきたら検証
 */
export async function confirmLawsonLink(
  lawsonUserId: string,
  verifyToken: string,
): Promise<LawsonVerifyConfirmResult> {
  if (isMock) {
    const expected = crypto
      .createHash('sha256')
      .update(`mock:${lawsonUserId}:${env.auth.secret}`)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();
    if (verifyToken.toUpperCase() === expected) {
      return { ok: true, lawsonUserId };
    }
    return { ok: false, reason: 'invalid_token' };
  }

  const res = await fetch(`${env.lawson.apiBase}/v1/link/confirm`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.lawson.apiKey,
      'x-partner-id': env.lawson.partnerId,
    },
    body: JSON.stringify({ lawsonUserId, verifyToken }),
  });
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  const json = (await res.json()) as { ok: boolean; lawsonUserId?: string; reason?: string };
  return json;
}

/**
 * 先行販売権の付与:
 *  当方DBに保存するだけでなく、ローチケ側にも
 *  「このローチケIDをイベントXの先行販売対象に登録」を通知する。
 */
export async function grantLawsonPresale(
  params: LawsonGrantPresaleParams,
): Promise<LawsonGrantPresaleResult> {
  if (isMock) {
    const externalGrantId = `mock-grant-${crypto.randomUUID()}`;
    return { ok: true, externalGrantId };
  }

  const res = await fetch(`${env.lawson.apiBase}/v1/presale/grant`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.lawson.apiKey,
      'x-partner-id': env.lawson.partnerId,
    },
    body: JSON.stringify({
      lawsonUserId: params.lawsonUserId,
      externalEventId: params.externalEventId,
      expiresAt: params.expiresAt?.toISOString(),
    }),
  });
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  const json = (await res.json()) as { ok: boolean; externalGrantId?: string; reason?: string };
  return json;
}
