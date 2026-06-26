/**
 * REIRIE への DM API
 *
 * GET  /api/me/dm  — 自分の DM 一覧 + 呼んでほしい名前 + NG ワード(クライアント事前判定用)
 * POST /api/me/dm  — DM を送信 (@ メンション展開・NG ワードチェックはサーバーで実施)
 *
 * セキュリティ:
 *  - NG ワード・長さチェックはサーバー側で必ず行う (クライアント判定は信用しない)。
 *  - @ メンションは送信者の preferredName で展開し、本文を確定して保存する。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { SendDirectMessageSchema, resolvePreferredName } from '@idol/shared';
import { requireSession } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  sendDirectMessage,
  listMyDirectMessages,
  getNgWords,
  DmNgWordError,
  DmValidationError,
} from '@/lib/dm';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const session = await requireSession();
  const [user, messages, ngWords] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferredName: true, displayName: true },
    }),
    listMyDirectMessages(session.user.id),
    getNgWords(),
  ]);

  return NextResponse.json({
    preferredName: user?.preferredName ?? null,
    resolvedName: resolvePreferredName(user?.preferredName, user?.displayName),
    ngWords,
    messages,
  });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSession();

  const json = (await req.json().catch(() => null)) as { body?: unknown } | null;
  const parsed = SendDirectMessageSchema.safeParse(json ?? {});
  if (!parsed.success) {
    throw errors.unprocessable('メッセージを入力してください', parsed.error.flatten());
  }

  try {
    const created = await sendDirectMessage(session.user.id, parsed.data.body);

    await logAudit({
      userId: session.user.id,
      action: 'dm.send',
      resource: `dm:${created.id}`,
      metadata: { length: created.body.length },
    });

    return NextResponse.json({ message: created });
  } catch (e) {
    if (e instanceof DmNgWordError) {
      // 422 + ヒットした NG ワードを返す (本文は保存しない)
      throw errors.unprocessable(e.message, { ngWords: e.ngWords });
    }
    if (e instanceof DmValidationError) {
      throw errors.badRequest(e.message);
    }
    throw e;
  }
});
