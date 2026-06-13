/**
 * POST /api/call/[roomId]/signal
 *
 * クライアントから offer / answer / ICE candidate を送信し、
 * 同じルームの別ピアに SSE 経由で配信する。
 *
 * Body:
 *   {
 *     from: string;     // 自分の clientId (hello で受け取ったもの)
 *     to?: string;      // 相手の clientId (省略時は部屋にブロードキャスト)
 *     payload: SignalMessage;  // { kind: 'offer'|'answer'|'ice', ... }
 *   }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { relaySignal } from '@/lib/call-hub';
import type { SignalMessage } from '@/lib/call-types';

export const runtime = 'nodejs';

type Body = {
  from?: unknown;
  to?: unknown;
  payload?: unknown;
};

function isSignalMessage(v: unknown): v is SignalMessage {
  if (!v || typeof v !== 'object') return false;
  const kind = (v as { kind?: unknown }).kind;
  if (kind === 'offer' || kind === 'answer') {
    return typeof (v as { sdp?: unknown }).sdp === 'string';
  }
  if (kind === 'ice') {
    // candidate は null または object
    const c = (v as { candidate?: unknown }).candidate;
    return c === null || (typeof c === 'object' && c !== null);
  }
  return false;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const from = typeof body.from === 'string' ? body.from : '';
  const to = typeof body.to === 'string' ? body.to : undefined;
  const payload = body.payload;
  if (!from) {
    return NextResponse.json({ error: 'from is required' }, { status: 400 });
  }
  if (!isSignalMessage(payload)) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const result = relaySignal(roomId, from, to, payload);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? 'relay failed' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
