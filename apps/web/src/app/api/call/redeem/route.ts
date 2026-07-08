/**
 * POST /api/call/redeem
 *
 * シリアルコードを引き換えて CallTicket を発行する。
 *
 * 認可:
 *   - ログイン必須
 *   - ファンクラブ会員 (STANDARD 以上 = canAccess(plan, 'MEMBERS')) 必須
 *
 * トランザクション:
 *   1. 入力コードを正規化
 *   2. CallSerial を「未使用かつ対象イベントが SCHEDULED/LIVE」で SELECT FOR UPDATE 相当に
 *   3. 同一イベント内で既に user のチケットがあれば拒否 (1ユーザー1チケット)
 *   4. queuePos = 既存チケット数 + 1 で CallTicket 作成
 *   5. CallSerial.usedById / usedAt をセット
 *
 * 競合制御:
 *   Prisma の interactive transactions (`prisma.$transaction`) で囲み、CallSerial の
 *   unique 制約 + CallTicket の (eventId, userId) unique を併用して二重発券を弾く。
 */
import { NextResponse } from 'next/server';
import { Prisma, prisma } from '@idol/db';
import { requireApiAccessLevel } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { RedeemCallSerialSchema, normalizeSerialCode } from '@idol/shared';

export const runtime = 'nodejs';

export const POST = handle(async (req) => {
  // ログイン + ファンクラブ会員 (MEMBERS = STANDARD 以上) 必須
  const session = await requireApiAccessLevel(req, 'MEMBERS');
  const userId = session!.user!.id;

  const body = await req.json();
  const { code } = RedeemCallSerialSchema.parse(body);

  const canonical = normalizeSerialCode(code);
  if (!canonical) {
    throw errors.badRequest('シリアルコードの形式が正しくありません');
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. シリアルを取得 (ロック目的で SELECT)
      const serial = await tx.callSerial.findUnique({
        where: { code: canonical },
        include: { event: true },
      });
      if (!serial) {
        throw errors.notFound('シリアルコードが見つかりません');
      }
      if (serial.usedById) {
        throw errors.conflict('このシリアルコードは既に使用されています');
      }
      if (serial.event.status === 'CANCELED' || serial.event.status === 'ENDED') {
        throw errors.badRequest('このイベントは既に終了またはキャンセルされています');
      }

      // 2. 同一イベントで既にチケットを持っていないか
      const existingTicket = await tx.callTicket.findUnique({
        where: { eventId_userId: { eventId: serial.eventId, userId } },
      });
      if (existingTicket) {
        throw errors.conflict('このイベントは既に引換済みです (1ユーザー1チケットまで)');
      }

      // 3. queuePos = 既存チケット数 + 1
      const existingCount = await tx.callTicket.count({
        where: { eventId: serial.eventId },
      });
      const queuePos = existingCount + 1;

      // 4. チケット作成 + シリアル消費 を同時に
      const ticket = await tx.callTicket.create({
        data: {
          eventId: serial.eventId,
          userId,
          serialId: serial.id,
          queuePos,
          status: 'WAITING',
        },
      });
      await tx.callSerial.update({
        where: { id: serial.id },
        data: { usedById: userId, usedAt: new Date() },
      });

      return { ticket, event: serial.event };
    });

    return NextResponse.json(
      {
        ticket: result.ticket,
        event: {
          id: result.event.id,
          title: result.event.title,
          startsAt: result.event.startsAt,
          status: result.event.status,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    // unique 違反は競合扱い
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw errors.conflict('同時引換が検出されました。再度お試しください');
    }
    throw err;
  }
});
